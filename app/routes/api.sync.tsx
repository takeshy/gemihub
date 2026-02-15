import type { Route } from "./+types/api.sync";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import {
  listUserFiles,
  readFile,
  readFileBase64,
  createFile,
  updateFile,
  getFileMetadata,
  deleteFile,
  moveFile,
  renameFile,
  ensureSubFolder,
  listFiles,
  findFileByExactName,
} from "~/services/google-drive.server";
import { isBinaryMimeType } from "~/services/sync-client-utils";
import {
  readRemoteSyncMeta,
  writeRemoteSyncMeta,
  rebuildSyncMeta,
  saveConflictBackup,
  SYNC_META_FILE_NAME,
  type SyncMeta,
} from "~/services/sync-meta.server";
import { parallelProcess } from "~/utils/parallel";
import { saveEdit } from "~/services/edit-history.server";
import { handleRagAction } from "~/services/sync-rag.server";
import { createLogContext, emitLog } from "~/services/logger.server";

// GET: Fetch remote sync meta + current file list
export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const logCtx = createLogContext(request, "/api/sync", validTokens.rootFolderId);
  logCtx.action = "getMeta";
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };

  // Read existing sync meta (snapshot of last sync), fallback to rebuild if missing
  const syncMetaFile = await findFileByExactName(
    validTokens.accessToken, SYNC_META_FILE_NAME, validTokens.rootFolderId
  );
  let remoteMeta: SyncMeta | null = null;
  if (syncMetaFile) {
    try {
      const content = await readFile(validTokens.accessToken, syncMetaFile.id);
      remoteMeta = JSON.parse(content) as SyncMeta;
    } catch { /* fall through to rebuild */ }
  }
  if (!remoteMeta) {
    remoteMeta = await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
  }

  logCtx.details = { fileCount: Object.keys(remoteMeta.files).length };
  emitLog(logCtx, 200);
  return jsonWithCookie({
    remoteMeta,
    syncMetaFileId: syncMetaFile?.id ?? null,
    files: Object.entries(remoteMeta.files).map(([id, f]) => ({
      id,
      name: f.name,
      mimeType: f.mimeType,
      md5Checksum: f.md5Checksum,
      modifiedTime: f.modifiedTime,
    })),
  });
}

// POST: pullDirect / resolve / pushFiles / fullPull / clearConflicts / detectUntracked / deleteUntracked / restoreUntracked
export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const logCtx = createLogContext(request, "/api/sync", validTokens.rootFolderId);
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };
  const logAndReturn = (data: unknown, init?: ResponseInit) => {
    emitLog(logCtx, (init as { status?: number } | undefined)?.status ?? 200);
    return jsonWithCookie(data, init);
  };

  const body = await request.json();
  const { action: actionType } = body;

  const VALID_ACTIONS = new Set([
    "pullDirect", "resolve", "fullPull",
    "clearConflicts", "detectUntracked", "deleteUntracked", "restoreUntracked",
    "listTrash", "restoreTrash", "listConflicts", "restoreConflict",
    "pushFiles",
    "ragRegister", "ragSave", "ragDeleteDoc", "ragRetryPending",
  ]);
  if (!actionType || !VALID_ACTIONS.has(actionType)) {
    emitLog(logCtx, 400, { error: `Invalid action: ${actionType}` });
    return jsonWithCookie({ error: `Invalid action: ${actionType}` }, { status: 400 });
  }
  logCtx.action = actionType;

  switch (actionType) {
    case "pullDirect": {
      // Download file contents only — no meta read/write on server
      const fileIds = body.fileIds as string[];
      const mimeTypes = (body.mimeTypes ?? {}) as Record<string, string>;
      const files = await parallelProcess(fileIds, async (fileId) => {
        if (isBinaryMimeType(mimeTypes[fileId])) {
          const content = await readFileBase64(validTokens.accessToken, fileId);
          return { fileId, content, encoding: "base64" as const };
        }
        const content = await readFile(validTokens.accessToken, fileId);
        return { fileId, content };
      }, 5);
      logCtx.details = { fileCount: fileIds.length };
      return logAndReturn({ files });
    }

    case "resolve": {
      // Resolve a conflict by choosing local or remote
      const { fileId, choice, localContent, isEditDelete, fileName: clientFileName } = body as {
        fileId: string;
        choice: "local" | "remote";
        localContent?: string;
        isEditDelete?: boolean;
        fileName?: string;
      };

      if (choice === "local" && localContent == null) {
        return logAndReturn({ error: "Missing localContent" }, { status: 400 });
      }

      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      const conflictFolder = settings.syncConflictFolder || "sync_conflicts";

      const remoteMeta =
        (await readRemoteSyncMeta(
          validTokens.accessToken,
          validTokens.rootFolderId
        )) ?? {
          lastUpdatedAt: new Date().toISOString(),
          files: {},
        };

      if (choice === "local") {
        if (isEditDelete) {
          // Edit-delete: file was deleted on remote — re-create it on Drive
          if (localContent != null) {
            const restoreName = clientFileName || fileId;
            const newFile = await createFile(
              validTokens.accessToken,
              restoreName,
              localContent,
              validTokens.rootFolderId,
              "text/plain"
            );
            remoteMeta.files[newFile.id] = {
              name: newFile.name,
              mimeType: newFile.mimeType,
              md5Checksum: newFile.md5Checksum ?? "",
              modifiedTime: newFile.modifiedTime ?? "",
            };
            remoteMeta.lastUpdatedAt = new Date().toISOString();
            await writeRemoteSyncMeta(
              validTokens.accessToken,
              validTokens.rootFolderId,
              remoteMeta
            );
            return logAndReturn({
              remoteMeta,
              file: {
                fileId: newFile.id,
                md5Checksum: newFile.md5Checksum ?? "",
                modifiedTime: newFile.modifiedTime ?? "",
                fileName: newFile.name,
              },
            });
          }
        } else {
          // Normal conflict: local wins — remote content is the loser, back it up
          try {
            const remoteContent = await readFile(validTokens.accessToken, fileId);
            const fileName = remoteMeta.files[fileId]?.name || fileId;
            await saveConflictBackup(
              validTokens.accessToken,
              validTokens.rootFolderId,
              conflictFolder,
              fileName,
              remoteContent
            );
          } catch {
            // Backup failure shouldn't block conflict resolution
          }
          // Update the Drive file with local content
          if (localContent != null) {
            const existingMeta = remoteMeta.files[fileId];
            const mimeType = existingMeta?.mimeType || "text/plain";
            const updated = await updateFile(validTokens.accessToken, fileId, localContent, mimeType);
            remoteMeta.files[fileId] = {
              name: updated.name,
              mimeType: updated.mimeType,
              md5Checksum: updated.md5Checksum ?? "",
              modifiedTime: updated.modifiedTime ?? "",
            };
          }
        }
      } else {
        if (isEditDelete) {
          // Edit-delete discard: back up local content, file already deleted on remote
          if (localContent) {
            const backupName = clientFileName || fileId;
            try {
              await saveConflictBackup(
                validTokens.accessToken,
                validTokens.rootFolderId,
                conflictFolder,
                backupName,
                localContent
              );
            } catch {
              // Backup failure shouldn't block conflict resolution
            }
          }
          // File is already not in remoteMeta — just return current meta
          remoteMeta.lastUpdatedAt = new Date().toISOString();
          await writeRemoteSyncMeta(
            validTokens.accessToken,
            validTokens.rootFolderId,
            remoteMeta
          );
          return logAndReturn({ remoteMeta });
        }

        // Normal conflict: remote wins — local content is the loser, back it up
        if (localContent) {
          const fileName = remoteMeta.files[fileId]?.name || fileId;
          try {
            await saveConflictBackup(
              validTokens.accessToken,
              validTokens.rootFolderId,
              conflictFolder,
              fileName,
              localContent
            );
          } catch {
            // Backup failure shouldn't block conflict resolution
          }
        }
        // Get current remote file metadata and update remote meta
        const meta = await getFileMetadata(
          validTokens.accessToken,
          fileId
        );
        remoteMeta.files[fileId] = {
          name: meta.name,
          mimeType: meta.mimeType,
          md5Checksum: meta.md5Checksum ?? "",
          modifiedTime: meta.modifiedTime ?? "",
        };
      }

      remoteMeta.lastUpdatedAt = new Date().toISOString();
      await writeRemoteSyncMeta(
        validTokens.accessToken,
        validTokens.rootFolderId,
        remoteMeta
      );

      // Return file metadata for both choices so client can update cache
      const resolvedEntry = remoteMeta.files[fileId];
      if (choice === "remote") {
        const content = await readFile(validTokens.accessToken, fileId);
        return logAndReturn({
          remoteMeta,
          file: {
            fileId,
            content,
            md5Checksum: resolvedEntry?.md5Checksum ?? "",
            modifiedTime: resolvedEntry?.modifiedTime ?? "",
            fileName: resolvedEntry?.name ?? "",
          },
        });
      }

      return logAndReturn({
        remoteMeta,
        file: resolvedEntry ? {
          fileId,
          md5Checksum: resolvedEntry.md5Checksum,
          modifiedTime: resolvedEntry.modifiedTime,
          fileName: resolvedEntry.name,
        } : undefined,
      });
    }

    case "fullPull": {
      // Full pull: rebuild meta, download all files (skip matching hashes)
      const skipHashes = (body.skipHashes ?? {}) as Record<string, string>;
      const skipBinaryContent = body.skipBinaryContent === true;
      const remoteMeta = await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);

      const fileEntries = Object.entries(remoteMeta.files).filter(
        ([_id, f]) => f.name !== "_sync-meta.json" && f.name !== "settings.json"
      );

      // Skip files where local hash matches remote, or binary content on mobile
      const toDownload = fileEntries.filter(
        ([id, f]) => {
          if (skipBinaryContent && isBinaryMimeType(f.mimeType)) return false;
          return !skipHashes[id] || skipHashes[id] !== f.md5Checksum;
        }
      );

      const files = await parallelProcess(toDownload, async ([fileId, fileMeta]) => {
        const binary = isBinaryMimeType(fileMeta.mimeType);
        const [content, meta] = await Promise.all([
          binary
            ? readFileBase64(validTokens.accessToken, fileId)
            : readFile(validTokens.accessToken, fileId),
          getFileMetadata(validTokens.accessToken, fileId),
        ]);
        return {
          fileId,
          content,
          md5Checksum: meta.md5Checksum ?? "",
          modifiedTime: meta.modifiedTime ?? "",
          fileName: meta.name,
          ...(binary ? { encoding: "base64" as const } : {}),
        };
      }, 5);

      logCtx.details = { fileCount: files.length };
      return logAndReturn({ files, remoteMeta });
    }

    case "clearConflicts": {
      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      const conflictFolderName = settings.syncConflictFolder || "sync_conflicts";

      try {
        const folderId = await ensureSubFolder(
          validTokens.accessToken,
          validTokens.rootFolderId,
          conflictFolderName
        );
        const files = await listFiles(validTokens.accessToken, folderId);
        await parallelProcess(files, async (f) => {
          await deleteFile(validTokens.accessToken, f.id);
        }, 5);

        // Remove conflict files from meta
        const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        if (remoteMeta) {
          for (const f of files) {
            delete remoteMeta.files[f.id];
          }
          remoteMeta.lastUpdatedAt = new Date().toISOString();
          await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, remoteMeta);
        }

        return logAndReturn({ deleted: files.length });
      } catch {
        return logAndReturn({ deleted: 0 });
      }
    }

    case "detectUntracked": {
      // Rebuild from Drive to get all files, compare with remoteMeta
      const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
      const allFiles = await listUserFiles(validTokens.accessToken, validTokens.rootFolderId);
      const trackedIds = new Set(Object.keys(remoteMeta?.files ?? {}));
      const systemNames = new Set(["_sync-meta.json", "settings.json"]);

      const untrackedFiles = allFiles
        .filter((f) => !trackedIds.has(f.id) && !systemNames.has(f.name))
        .map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
        }));

      return logAndReturn({ untrackedFiles });
    }

    case "deleteUntracked": {
      const fileIds = body.fileIds as string[];
      let deletedCount = 0;
      await parallelProcess(fileIds, async (id) => {
        try {
          await deleteFile(validTokens.accessToken, id);
          deletedCount++;
        } catch {
          // skip files that fail to delete
        }
      }, 5);
      logCtx.details = { fileCount: fileIds.length, deletedCount };
      return logAndReturn({ deleted: deletedCount });
    }

    case "restoreUntracked": {
      const fileIds = body.fileIds as string[];
      const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
        ?? { lastUpdatedAt: new Date().toISOString(), files: {} };

      for (const fileId of fileIds) {
        try {
          const meta = await getFileMetadata(validTokens.accessToken, fileId);
          remoteMeta.files[fileId] = {
            name: meta.name,
            mimeType: meta.mimeType,
            md5Checksum: meta.md5Checksum ?? "",
            modifiedTime: meta.modifiedTime ?? "",
          };
        } catch {
          // skip files that can't be read
        }
      }
      remoteMeta.lastUpdatedAt = new Date().toISOString();
      await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, remoteMeta);

      return logAndReturn({ restored: fileIds.length, remoteMeta });
    }

    case "listTrash": {
      try {
        const trashFolderId = await ensureSubFolder(
          validTokens.accessToken,
          validTokens.rootFolderId,
          "trash"
        );
        const files = await listFiles(validTokens.accessToken, trashFolderId);
        return logAndReturn({
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
          })),
        });
      } catch {
        return logAndReturn({ files: [] });
      }
    }

    case "restoreTrash": {
      const fileIds = body.fileIds as string[];
      const renames = (body.renames ?? {}) as Record<string, string>;
      try {
        const trashFolderId = await ensureSubFolder(
          validTokens.accessToken,
          validTokens.rootFolderId,
          "trash"
        );
        const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
          ?? { lastUpdatedAt: new Date().toISOString(), files: {} };

        let restoredCount = 0;
        for (const fileId of fileIds) {
          try {
            // Move file back to root folder
            await moveFile(validTokens.accessToken, fileId, validTokens.rootFolderId, trashFolderId);
            // Rename if requested
            const newName = renames[fileId];
            if (newName) {
              await renameFile(validTokens.accessToken, fileId, newName);
            }
            // Add back to sync meta
            const meta = await getFileMetadata(validTokens.accessToken, fileId);
            remoteMeta.files[fileId] = {
              name: meta.name,
              mimeType: meta.mimeType,
              md5Checksum: meta.md5Checksum ?? "",
              modifiedTime: meta.modifiedTime ?? "",
            };
            restoredCount++;
          } catch {
            // skip files that fail to restore
          }
        }

        if (restoredCount > 0) {
          remoteMeta.lastUpdatedAt = new Date().toISOString();
          await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, remoteMeta);
        }
        return logAndReturn({ restored: restoredCount, remoteMeta });
      } catch {
        return logAndReturn({ restored: 0 });
      }
    }

    case "listConflicts": {
      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      const conflictFolderName = settings.syncConflictFolder || "sync_conflicts";
      try {
        const folderId = await ensureSubFolder(
          validTokens.accessToken,
          validTokens.rootFolderId,
          conflictFolderName
        );
        const files = await listFiles(validTokens.accessToken, folderId);
        return logAndReturn({
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
          })),
        });
      } catch {
        return logAndReturn({ files: [] });
      }
    }

    case "restoreConflict": {
      const fileIds = body.fileIds as string[];
      const renames = (body.renames ?? {}) as Record<string, string>;
      try {
        const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
          ?? { lastUpdatedAt: new Date().toISOString(), files: {} };

        for (const fileId of fileIds) {
          // Read conflict file content
          const content = await readFile(validTokens.accessToken, fileId);
          const meta = await getFileMetadata(validTokens.accessToken, fileId);
          // Determine restored name: use provided rename, or strip timestamp prefix
          let restoreName = renames[fileId] ?? meta.name;
          if (!renames[fileId]) {
            // Strip timestamp like "filename_20260208_123456.md" → "filename.md"
            restoreName = restoreName.replace(/_\d{8}_\d{6}(?=\.)/, "");
          }
          // Create new file in root folder
          const newFile = await createFile(
            validTokens.accessToken,
            restoreName,
            content,
            validTokens.rootFolderId,
            meta.mimeType || "text/plain"
          );
          // Add to sync meta
          const newMeta = await getFileMetadata(validTokens.accessToken, newFile.id);
          remoteMeta.files[newFile.id] = {
            name: newMeta.name,
            mimeType: newMeta.mimeType,
            md5Checksum: newMeta.md5Checksum ?? "",
            modifiedTime: newMeta.modifiedTime ?? "",
          };
          // Delete the conflict backup
          await deleteFile(validTokens.accessToken, fileId).catch(() => {});
          // Remove conflict file from meta if it was there
          delete remoteMeta.files[fileId];
        }

        remoteMeta.lastUpdatedAt = new Date().toISOString();
        await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, remoteMeta);
        return logAndReturn({ restored: fileIds.length, remoteMeta });
      } catch {
        return logAndReturn({ restored: 0, error: "Restore failed" });
      }
    }

    case "pushFiles": {
      const files = body.files as Array<{ fileId: string; content: string }>;
      if (!Array.isArray(files) || files.length === 0) {
        return logAndReturn({ error: "Missing or empty files array" }, { status: 400 });
      }

      const isNotFoundError = (err: unknown) =>
        err instanceof Error && /\b404\b/.test(err.message);

      // Use client-provided remoteMeta/syncMetaFileId to avoid redundant Drive API calls
      const clientRemoteMeta = body.remoteMeta as SyncMeta | undefined;
      const syncMetaFileId = (body.syncMetaFileId as string) ?? null;
      const pushRemoteMeta: SyncMeta = clientRemoteMeta
        ?? (await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId))
        ?? { lastUpdatedAt: new Date().toISOString(), files: {} as SyncMeta["files"] };

      // Update files in parallel: read old content, skip upload if unchanged
      const pushResults = await parallelProcess(files, async ({ fileId, content }) => {
        let oldContent: string | null = null;
        try {
          oldContent = await readFile(validTokens.accessToken, fileId);
        } catch {
          // File might be new or unreadable, skip history
        }

        // Skip upload if content is identical to remote
        if (oldContent !== null && oldContent === content) {
          const existingMeta = pushRemoteMeta.files[fileId];
          return {
            ok: true as const,
            uploaded: false,
            fileId,
            md5Checksum: existingMeta?.md5Checksum ?? "",
            modifiedTime: existingMeta?.modifiedTime ?? "",
            name: existingMeta?.name ?? "",
            mimeType: existingMeta?.mimeType ?? "",
            oldContent,
            newContent: content,
          };
        }

        const existingMeta = pushRemoteMeta.files[fileId];
        const mimeType = existingMeta?.mimeType || "text/plain";
        try {
          const updated = await updateFile(validTokens.accessToken, fileId, content, mimeType);
          return {
            ok: true as const,
            uploaded: true,
            fileId,
            md5Checksum: updated.md5Checksum ?? "",
            modifiedTime: updated.modifiedTime ?? "",
            name: updated.name,
            mimeType: updated.mimeType,
            oldContent,
            newContent: content,
          };
        } catch (err) {
          // Skip files that no longer exist on Drive.
          if (isNotFoundError(err)) {
            return {
              ok: false as const,
              fileId,
            };
          }
          throw err;
        }
      }, 5);

      const successful = pushResults.filter((r): r is {
        ok: true;
        uploaded: boolean;
        fileId: string;
        md5Checksum: string;
        modifiedTime: string;
        name: string;
        mimeType: string;
        oldContent: string | null;
        newContent: string;
      } => r.ok);
      const skippedFileIds = pushResults.filter((r) => !r.ok).map((r) => r.fileId);
      const actuallyUploaded = successful.filter((r) => r.uploaded);

      // Update meta entries only for files that were actually uploaded
      for (const r of actuallyUploaded) {
        const existing = pushRemoteMeta.files[r.fileId];
        pushRemoteMeta.files[r.fileId] = {
          ...existing,
          name: r.name || existing?.name || "",
          mimeType: r.mimeType || existing?.mimeType || "",
          md5Checksum: r.md5Checksum,
          modifiedTime: r.modifiedTime,
        };
      }

      if (actuallyUploaded.length > 0) {
        pushRemoteMeta.lastUpdatedAt = new Date().toISOString();
        // Write sync meta once, using fileId directly if available to skip findFileByExactName
        if (syncMetaFileId) {
          await updateFile(validTokens.accessToken, syncMetaFileId,
            JSON.stringify(pushRemoteMeta, null, 2), "application/json");
        } else {
          await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, pushRemoteMeta);
        }
      }

      // Save remote edit history in background (best-effort, does not block response)
      // Skip binary files — they have no meaningful text diff
      const historyEntries = successful.filter(
        (r) => r.oldContent != null && r.newContent != null && r.oldContent !== r.newContent
          && !isBinaryMimeType(r.mimeType)
      );
      if (historyEntries.length > 0) {
        (async () => {
          try {
            const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
            await parallelProcess(historyEntries, async (r) => {
              await saveEdit(validTokens.accessToken, validTokens.rootFolderId, settings.editHistory, {
                path: r.name,
                oldContent: r.oldContent!,
                newContent: r.newContent,
                source: "manual",
              });
            }, 5);
          } catch {
            // best-effort
          }
        })();
      }

      logCtx.details = { fileCount: files.length };
      return logAndReturn({
        results: successful.map((r) => ({
          fileId: r.fileId,
          md5Checksum: r.md5Checksum,
          modifiedTime: r.modifiedTime,
        })),
        skippedFileIds,
        remoteMeta: pushRemoteMeta,
      });
    }

    case "ragRegister":
    case "ragSave":
    case "ragDeleteDoc":
    case "ragRetryPending": {
      const result = await handleRagAction(actionType, body, { validTokens, jsonWithCookie });
      emitLog(logCtx, result.status);
      return result;
    }

    default:
      emitLog(logCtx, 400, { error: "Unknown action" });
      return jsonWithCookie({ error: "Unknown action" }, { status: 400 });
  }
}
