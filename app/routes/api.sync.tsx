import type { Route } from "./+types/api.sync";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import {
  listUserFiles,
  readFile,
  createFile,
  updateFile,
  getFileMetadata,
  deleteFile,
  moveFile,
  renameFile,
  ensureSubFolder,
  listFiles,
} from "~/services/google-drive.server";
import {
  readRemoteSyncMeta,
  writeRemoteSyncMeta,
  rebuildSyncMeta,
  computeSyncDiff,
  saveConflictBackup,
  type SyncMeta,
} from "~/services/sync-meta.server";
import { parallelProcess } from "~/utils/parallel";
import { saveEdit } from "~/services/edit-history.server";
import { handleRagAction } from "~/services/sync-rag.server";

// GET: Fetch remote sync meta + current file list
export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };

  // Read existing sync meta (snapshot of last sync), fallback to rebuild if missing
  const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
    ?? await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);

  return jsonWithCookie({
    remoteMeta,
    files: Object.entries(remoteMeta.files).map(([id, f]) => ({
      id,
      name: f.name,
      mimeType: f.mimeType,
      md5Checksum: f.md5Checksum,
      modifiedTime: f.modifiedTime,
    })),
  });
}

// POST: diff / pull / resolve / pushFiles / fullPull / clearConflicts / detectUntracked / deleteUntracked / restoreUntracked
export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };

  const body = await request.json();
  const { action: actionType } = body;

  const VALID_ACTIONS = new Set([
    "diff", "pull", "resolve", "fullPull",
    "clearConflicts", "detectUntracked", "deleteUntracked", "restoreUntracked",
    "listTrash", "restoreTrash", "listConflicts", "restoreConflict",
    "pushFiles",
    "ragRegister", "ragSave", "ragDeleteDoc", "ragRetryPending",
  ]);
  if (!actionType || !VALID_ACTIONS.has(actionType)) {
    return jsonWithCookie({ error: `Invalid action: ${actionType}` }, { status: 400 });
  }

  switch (actionType) {
    case "diff": {
      const localMeta = body.localMeta as SyncMeta | null;
      const locallyModifiedIds = new Set<string>(body.locallyModifiedFileIds ?? []);
      // Read existing sync meta (snapshot of last sync), fallback to rebuild if missing
      const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
        ?? await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
      const diff = computeSyncDiff(localMeta, remoteMeta, locallyModifiedIds);
      return jsonWithCookie({ diff, remoteMeta });
    }

    case "pull": {
      // Return file contents + metadata for specified file IDs (parallelized)
      const fileIds = body.fileIds as string[];
      const localOnlyIds: string[] = Array.isArray(body.localOnlyIds)
        ? (body.localOnlyIds as unknown[]).filter((v): v is string => typeof v === "string")
        : [];

      const results = await parallelProcess(fileIds, async (fileId) => {
        const [content, meta] = await Promise.all([
          readFile(validTokens.accessToken, fileId),
          getFileMetadata(validTokens.accessToken, fileId),
        ]);
        return {
          fileId,
          content,
          md5Checksum: meta.md5Checksum ?? "",
          modifiedTime: meta.modifiedTime ?? "",
          fileName: meta.name,
          mimeType: meta.mimeType,
          createdTime: meta.createdTime,
          webViewLink: meta.webViewLink,
        };
      }, 5);

      if (results.length > 0 || localOnlyIds.length > 0) {
        // Update remote sync meta for pulled files and prune deleted entries
        const remoteMeta =
          (await readRemoteSyncMeta(
            validTokens.accessToken,
            validTokens.rootFolderId
          )) ?? await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);

        for (const fileId of localOnlyIds) {
          delete remoteMeta.files[fileId];
        }

        for (const file of results) {
          const existing = remoteMeta.files[file.fileId];
          remoteMeta.files[file.fileId] = {
            ...existing,
            name: file.fileName || existing?.name || "",
            mimeType: file.mimeType || existing?.mimeType || "",
            md5Checksum: file.md5Checksum,
            modifiedTime: file.modifiedTime,
            createdTime: file.createdTime ?? existing?.createdTime,
            webViewLink: file.webViewLink ?? existing?.webViewLink,
          };
        }
        remoteMeta.lastUpdatedAt = new Date().toISOString();
        await writeRemoteSyncMeta(
          validTokens.accessToken,
          validTokens.rootFolderId,
          remoteMeta
        );
      }

      return jsonWithCookie({ files: results });
    }

    case "resolve": {
      // Resolve a conflict by choosing local or remote
      const { fileId, choice, localContent } = body as {
        fileId: string;
        choice: "local" | "remote";
        localContent?: string;
      };

      if (choice === "local" && localContent == null) {
        return jsonWithCookie({ error: "Missing localContent" }, { status: 400 });
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
        // Local wins — remote content is the loser, back it up
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
      } else {
        // Remote wins — local content is the loser, back it up
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
        const [content, meta] = await Promise.all([
          readFile(validTokens.accessToken, fileId),
          getFileMetadata(validTokens.accessToken, fileId),
        ]);
        return jsonWithCookie({
          remoteMeta,
          file: {
            fileId,
            content,
            md5Checksum: meta.md5Checksum ?? "",
            modifiedTime: meta.modifiedTime ?? "",
            fileName: meta.name,
          },
        });
      }

      return jsonWithCookie({
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
      const remoteMeta = await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);

      const fileEntries = Object.entries(remoteMeta.files).filter(
        ([_id, f]) => f.name !== "_sync-meta.json" && f.name !== "settings.json"
      );

      // Skip files where local hash matches remote
      const toDownload = fileEntries.filter(
        ([id, f]) => !skipHashes[id] || skipHashes[id] !== f.md5Checksum
      );

      const files = await parallelProcess(toDownload, async ([fileId]) => {
        const [content, meta] = await Promise.all([
          readFile(validTokens.accessToken, fileId),
          getFileMetadata(validTokens.accessToken, fileId),
        ]);
        return {
          fileId,
          content,
          md5Checksum: meta.md5Checksum ?? "",
          modifiedTime: meta.modifiedTime ?? "",
          fileName: meta.name,
        };
      }, 5);

      return jsonWithCookie({ files, remoteMeta });
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

        return jsonWithCookie({ deleted: files.length });
      } catch {
        return jsonWithCookie({ deleted: 0 });
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

      return jsonWithCookie({ untrackedFiles });
    }

    case "deleteUntracked": {
      const fileIds = body.fileIds as string[];
      await parallelProcess(fileIds, async (id) => {
        await deleteFile(validTokens.accessToken, id);
      }, 5);
      return jsonWithCookie({ deleted: fileIds.length });
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

      return jsonWithCookie({ restored: fileIds.length, remoteMeta });
    }

    case "listTrash": {
      try {
        const trashFolderId = await ensureSubFolder(
          validTokens.accessToken,
          validTokens.rootFolderId,
          "trash"
        );
        const files = await listFiles(validTokens.accessToken, trashFolderId);
        return jsonWithCookie({
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
          })),
        });
      } catch {
        return jsonWithCookie({ files: [] });
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

        for (const fileId of fileIds) {
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
        }

        remoteMeta.lastUpdatedAt = new Date().toISOString();
        await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, remoteMeta);
        return jsonWithCookie({ restored: fileIds.length, remoteMeta });
      } catch {
        return jsonWithCookie({ restored: 0 });
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
        return jsonWithCookie({
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
          })),
        });
      } catch {
        return jsonWithCookie({ files: [] });
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
        return jsonWithCookie({ restored: fileIds.length, remoteMeta });
      } catch {
        return jsonWithCookie({ restored: 0, error: "Restore failed" });
      }
    }

    case "pushFiles": {
      const files = body.files as Array<{ fileId: string; content: string }>;
      if (!Array.isArray(files) || files.length === 0) {
        return jsonWithCookie({ error: "Missing or empty files array" }, { status: 400 });
      }

      const isNotFoundError = (err: unknown) =>
        err instanceof Error && /\b404\b/.test(err.message);

      // Read sync meta once
      const pushRemoteMeta =
        (await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId))
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
        // Write sync meta once
        await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, pushRemoteMeta);
      }

      // Save remote edit history in background (best-effort, does not block response)
      const historyEntries = successful.filter(
        (r) => r.oldContent != null && r.newContent != null && r.oldContent !== r.newContent
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

      return jsonWithCookie({
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
    case "ragRetryPending":
      return handleRagAction(actionType, body, { validTokens, jsonWithCookie });

    default:
      return jsonWithCookie({ error: "Unknown action" }, { status: 400 });
  }
}
