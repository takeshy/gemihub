import type { Route } from "./+types/api.sync";
import { requireAuth, setTokens, commitSession } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import {
  listUserFiles,
  readFile,
  readFileBase64,
  createFile,
  createFileBinary,
  updateFile,
  updateFileBinary,
  getFileMetadata,
  deleteFile,
  moveFile,
  renameFile,
  ensureSubFolder,
  listFiles,
  findFileByExactName,
} from "~/services/google-drive.server";
import { isBinaryMimeType, LARGE_FILE_CACHE_THRESHOLD } from "~/services/sync-client-utils";
import {
  readRemoteSyncMeta,
  writeRemoteSyncMeta,
  rebuildSyncMeta,
  saveConflictBackup,
  SYNC_META_FILE_NAME,
  type SyncMeta,
} from "~/services/sync-meta.server";
import { SETTINGS_FILE_NAME, ENCRYPTED_AUTH_FILE_NAME } from "~/services/sync-diff";
import { parallelProcess } from "~/utils/parallel";
import { saveEdit } from "~/services/edit-history.server";
import { handleRagAction } from "~/services/sync-rag.server";
import { createLogContext, emitLog } from "~/services/logger.server";

function guessMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".canvas")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "text/yaml";
  if (lower.endsWith(".base")) return "text/yaml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xml")) return "application/xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  return "text/plain";
}

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
    "pushFiles", "rebuildTree", "migrateRootFolder",
    "ragRegister", "ragSave", "ragDeleteDoc", "ragRetryPending",
    "permanentDelete",
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
      const { fileId, choice, localContent, isEditDelete, fileName: clientFileName, encoding } = body as {
        fileId: string;
        choice: "local" | "remote";
        localContent?: string;
        isEditDelete?: boolean;
        fileName?: string;
        encoding?: "base64";
      };

      if (choice === "local" && localContent == null) {
        return logAndReturn({ error: "Missing localContent" }, { status: 400 });
      }

      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      const conflictFolder = settings.syncConflictFolder || "sync_conflicts";

      // Snapshot for name/mimeType lookups only. The final meta write below
      // re-reads the latest _sync-meta.json so entries written by concurrent
      // pushes are not clobbered (same strategy as pushFiles).
      const metaSnapshot =
        (await readRemoteSyncMeta(
          validTokens.accessToken,
          validTokens.rootFolderId
        )) ?? {
          lastUpdatedAt: new Date().toISOString(),
          files: {},
        };
      const isLocalBinary = encoding === "base64";

      // Apply the resolution to Drive, collecting the single meta entry to merge
      let resolvedFileId = fileId;
      let resolvedEntry: SyncMeta["files"][string] | null = null;

      if (choice === "local") {
        if (isEditDelete) {
          // Edit-delete: file was deleted on remote — re-create it on Drive
          const restoreName = clientFileName || fileId;
          const restoreMime = guessMimeType(restoreName);
          const newFile = isLocalBinary
            ? await createFileBinary(
                validTokens.accessToken, restoreName, Buffer.from(localContent!, "base64"),
                validTokens.rootFolderId, restoreMime,
              )
            : await createFile(
                validTokens.accessToken, restoreName, localContent!,
                validTokens.rootFolderId, restoreMime,
              );
          resolvedFileId = newFile.id;
          resolvedEntry = {
            name: newFile.name,
            mimeType: newFile.mimeType,
            md5Checksum: newFile.md5Checksum ?? "",
            modifiedTime: newFile.modifiedTime ?? "",
            size: newFile.size,
          };
        } else {
          // Normal conflict: local wins — remote content is the loser, back it up
          const existingMeta = metaSnapshot.files[fileId];
          const fileName = existingMeta?.name || fileId;
          const remoteBinary = isBinaryMimeType(existingMeta?.mimeType);
          try {
            const remoteContent = remoteBinary
              ? await readFileBase64(validTokens.accessToken, fileId)
              : await readFile(validTokens.accessToken, fileId);
            await saveConflictBackup(
              validTokens.accessToken,
              validTokens.rootFolderId,
              conflictFolder,
              fileName,
              remoteContent,
              remoteBinary ? { encoding: "base64", mimeType: existingMeta?.mimeType } : {}
            );
          } catch {
            // Backup failure shouldn't block conflict resolution
          }
          // Update the Drive file with local content (binary cache content is base64)
          const mimeType = existingMeta?.mimeType || guessMimeType(fileName);
          const updated = isLocalBinary
            ? await updateFileBinary(
                validTokens.accessToken, fileId, Buffer.from(localContent!, "base64"), mimeType,
              )
            : await updateFile(validTokens.accessToken, fileId, localContent!, mimeType);
          resolvedEntry = {
            name: updated.name,
            mimeType: updated.mimeType,
            md5Checksum: updated.md5Checksum ?? "",
            modifiedTime: updated.modifiedTime ?? "",
            size: updated.size,
          };
        }
      } else {
        // Remote wins (or edit-delete discard): local content is the loser, back it up
        if (localContent) {
          const backupName = isEditDelete
            ? (clientFileName || fileId)
            : (metaSnapshot.files[fileId]?.name || fileId);
          try {
            await saveConflictBackup(
              validTokens.accessToken,
              validTokens.rootFolderId,
              conflictFolder,
              backupName,
              localContent,
              isLocalBinary ? { encoding: "base64", mimeType: guessMimeType(backupName) } : {}
            );
          } catch {
            // Backup failure shouldn't block conflict resolution
          }
        }
        if (!isEditDelete) {
          // Normal conflict: refresh the meta entry from the current Drive file
          const meta = await getFileMetadata(validTokens.accessToken, fileId);
          resolvedEntry = {
            name: meta.name,
            mimeType: meta.mimeType,
            md5Checksum: meta.md5Checksum ?? "",
            modifiedTime: meta.modifiedTime ?? "",
            size: meta.size,
          };
        }
        // Edit-delete discard: file is already gone from remote meta — nothing to merge
      }

      // Merge the resolved entry into the LATEST meta (re-read after the Drive
      // operations above) so concurrent pushes are not clobbered.
      const remoteMeta =
        (await readRemoteSyncMeta(
          validTokens.accessToken,
          validTokens.rootFolderId
        )) ?? {
          lastUpdatedAt: new Date().toISOString(),
          files: {},
        };
      if (resolvedEntry) {
        remoteMeta.files[resolvedFileId] = resolvedEntry;
      }
      remoteMeta.lastUpdatedAt = new Date().toISOString();
      await writeRemoteSyncMeta(
        validTokens.accessToken,
        validTokens.rootFolderId,
        remoteMeta
      );

      // Return file metadata so the client can update its cache
      if (choice === "remote" && !isEditDelete) {
        const entry = remoteMeta.files[fileId];
        const remoteBinary = isBinaryMimeType(entry?.mimeType);
        const content = remoteBinary
          ? await readFileBase64(validTokens.accessToken, fileId)
          : await readFile(validTokens.accessToken, fileId);
        return logAndReturn({
          remoteMeta,
          file: {
            fileId,
            content,
            md5Checksum: entry?.md5Checksum ?? "",
            modifiedTime: entry?.modifiedTime ?? "",
            fileName: entry?.name ?? "",
            ...(remoteBinary ? { encoding: "base64" as const } : {}),
          },
        });
      }

      return logAndReturn({
        remoteMeta,
        file: resolvedEntry ? {
          fileId: resolvedFileId,
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
        ([_id, f]) =>
          f.name !== SYNC_META_FILE_NAME &&
          f.name !== SETTINGS_FILE_NAME &&
          f.name !== ENCRYPTED_AUTH_FILE_NAME
      );

      const skipLargeFiles = body.skipLargeFiles === true;
      // Skip files where local hash matches remote, binary content on mobile, or large files
      const toDownload = fileEntries.filter(
        ([id, f]) => {
          if (skipBinaryContent && isBinaryMimeType(f.mimeType)) return false;
          if (skipLargeFiles && f.size && Number(f.size) > LARGE_FILE_CACHE_THRESHOLD) return false;
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
      const systemNames = new Set([SYNC_META_FILE_NAME, SETTINGS_FILE_NAME, ENCRYPTED_AUTH_FILE_NAME]);

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
      const trashFolderId = await ensureSubFolder(
        validTokens.accessToken,
        validTokens.rootFolderId,
        "trash"
      );
      let deletedCount = 0;
      await parallelProcess(fileIds, async (id) => {
        try {
          await moveFile(validTokens.accessToken, id, trashFolderId, validTokens.rootFolderId);
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

      // Collect entries from Drive first; read+write meta once afterwards so
      // entries written by concurrent pushes are not clobbered.
      const entries: Array<[string, SyncMeta["files"][string]]> = [];
      for (const fileId of fileIds) {
        try {
          const meta = await getFileMetadata(validTokens.accessToken, fileId);
          entries.push([fileId, {
            name: meta.name,
            mimeType: meta.mimeType,
            md5Checksum: meta.md5Checksum ?? "",
            modifiedTime: meta.modifiedTime ?? "",
            size: meta.size,
          }]);
        } catch {
          // skip files that can't be read
        }
      }

      const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
        ?? { lastUpdatedAt: new Date().toISOString(), files: {} };
      for (const [fileId, entry] of entries) {
        remoteMeta.files[fileId] = entry;
      }
      remoteMeta.lastUpdatedAt = new Date().toISOString();
      await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, remoteMeta);

      return logAndReturn({ restored: entries.length, remoteMeta });
    }

    case "permanentDelete": {
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

        // Collect entries during the Drive operations; read+write meta once
        // afterwards so concurrent pushes are not clobbered.
        const entries: Array<[string, SyncMeta["files"][string]]> = [];
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
            entries.push([fileId, {
              name: meta.name,
              mimeType: meta.mimeType,
              md5Checksum: meta.md5Checksum ?? "",
              modifiedTime: meta.modifiedTime ?? "",
              size: meta.size,
            }]);
          } catch {
            // skip files that fail to restore
          }
        }

        const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
          ?? { lastUpdatedAt: new Date().toISOString(), files: {} };
        if (entries.length > 0) {
          for (const [fileId, entry] of entries) {
            remoteMeta.files[fileId] = entry;
          }
          remoteMeta.lastUpdatedAt = new Date().toISOString();
          await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, remoteMeta);
        }
        return logAndReturn({ restored: entries.length, remoteMeta });
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
        // Collect adds/removals during the Drive operations; read+write meta
        // once afterwards so concurrent pushes are not clobbered.
        const added: Array<[string, SyncMeta["files"][string]]> = [];
        const removedIds: string[] = [];
        for (const fileId of fileIds) {
          const meta = await getFileMetadata(validTokens.accessToken, fileId);
          const isBinary = isBinaryMimeType(meta.mimeType);
          const content = isBinary
            ? await readFileBase64(validTokens.accessToken, fileId)
            : await readFile(validTokens.accessToken, fileId);
          // Determine restored name: use provided rename, or strip timestamp prefix
          let restoreName = renames[fileId] ?? meta.name;
          if (!renames[fileId]) {
            // Strip timestamp like "filename_20260208_123456.md" → "filename.md"
            restoreName = restoreName.replace(/_\d{8}_\d{6}(?=\.)/, "");
          }
          // Create new file in root folder
          const newFile = isBinary
            ? await createFileBinary(
                validTokens.accessToken,
                restoreName,
                Buffer.from(content, "base64"),
                validTokens.rootFolderId,
                meta.mimeType || "application/octet-stream"
              )
            : await createFile(
                validTokens.accessToken,
                restoreName,
                content,
                validTokens.rootFolderId,
                meta.mimeType || "text/plain"
              );
          // Add to sync meta
          const newMeta = await getFileMetadata(validTokens.accessToken, newFile.id);
          added.push([newFile.id, {
            name: newMeta.name,
            mimeType: newMeta.mimeType,
            md5Checksum: newMeta.md5Checksum ?? "",
            modifiedTime: newMeta.modifiedTime ?? "",
            size: newMeta.size,
          }]);
          // Delete the conflict backup
          await deleteFile(validTokens.accessToken, fileId).catch(() => {});
          // Remove conflict file from meta if it was there
          removedIds.push(fileId);
        }

        const remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
          ?? { lastUpdatedAt: new Date().toISOString(), files: {} };
        for (const [newId, entry] of added) {
          remoteMeta.files[newId] = entry;
        }
        for (const fileId of removedIds) {
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
      const files = body.files as Array<{ fileId: string; content: string; fileName?: string; encoding?: "base64" }>;
      if (!Array.isArray(files) || files.length === 0) {
        return logAndReturn({ error: "Missing or empty files array" }, { status: 400 });
      }
      const forceRecreate = body.forceRecreate === true;

      const isNotFoundError = (err: unknown) =>
        err instanceof Error && /\b404\b/.test(err.message);

      // Use client-provided remoteMeta/syncMetaFileId to avoid redundant Drive API calls
      // When forceRecreate, start from empty meta so it gets fully rebuilt from push results
      const clientRemoteMeta = body.remoteMeta as SyncMeta | undefined;
      const syncMetaFileId = (body.syncMetaFileId as string) ?? null;
      let pushRemoteMeta: SyncMeta = forceRecreate
        ? { lastUpdatedAt: new Date().toISOString(), files: {} as SyncMeta["files"] }
        : clientRemoteMeta
          ?? (await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId))
          ?? { lastUpdatedAt: new Date().toISOString(), files: {} as SyncMeta["files"] };

      // Update files in parallel: read old content, skip upload if unchanged
      const pushResults = await parallelProcess(files, async ({ fileId, content, fileName, encoding }) => {
        const isBinary = encoding === "base64";

        // --- Binary file path: decode base64 → use binary upload/create ---
        if (isBinary) {
          const buf = Buffer.from(content, "base64");
          const mimeType = fileName ? guessMimeType(fileName) : "application/octet-stream";
          try {
            const updated = await updateFileBinary(validTokens.accessToken, fileId, buf, mimeType);
            return {
              ok: true as const,
              uploaded: true,
              fileId,
              newFileId: undefined,
              md5Checksum: updated.md5Checksum ?? "",
              modifiedTime: updated.modifiedTime ?? "",
              name: updated.name,
              mimeType: updated.mimeType,
              size: updated.size,
              oldContent: null,
              newContent: null,
            };
          } catch (err) {
            if (isNotFoundError(err) && forceRecreate && fileName) {
              try {
                const created = await createFileBinary(
                  validTokens.accessToken, fileName, buf,
                  validTokens.rootFolderId, mimeType,
                );
                return {
                  ok: true as const,
                  uploaded: true,
                  fileId,
                  newFileId: created.id,
                  md5Checksum: created.md5Checksum ?? "",
                  modifiedTime: created.modifiedTime ?? "",
                  name: created.name,
                  mimeType: created.mimeType,
                  size: created.size,
                  oldContent: null,
                  newContent: null,
                };
              } catch {
                return { ok: false as const, fileId };
              }
            }
            if (isNotFoundError(err)) {
              return { ok: false as const, fileId };
            }
            throw err;
          }
        }

        // --- Text file path ---
        let oldContent: string | null = null;
        try {
          oldContent = await readFile(validTokens.accessToken, fileId);
        } catch {
          // File might be new or unreadable, skip history
        }

        // Skip upload if content is identical to remote
        // When forceRecreate, always upload so meta gets rebuilt with valid md5/modifiedTime
        if (!forceRecreate && oldContent !== null && oldContent === content) {
          const existingMeta = pushRemoteMeta.files[fileId];
          return {
            ok: true as const,
            uploaded: false,
            fileId,
            newFileId: undefined,
            md5Checksum: existingMeta?.md5Checksum ?? "",
            modifiedTime: existingMeta?.modifiedTime ?? "",
            name: existingMeta?.name ?? fileName ?? "",
            mimeType: existingMeta?.mimeType ?? "",
            size: existingMeta?.size,
            oldContent,
            newContent: content,
          };
        }

        const existingMeta = pushRemoteMeta.files[fileId];
        const mimeType = existingMeta?.mimeType || (fileName ? guessMimeType(fileName) : "text/plain");
        try {
          const updated = await updateFile(validTokens.accessToken, fileId, content, mimeType);
          return {
            ok: true as const,
            uploaded: true,
            fileId,
            newFileId: undefined,
            md5Checksum: updated.md5Checksum ?? "",
            modifiedTime: updated.modifiedTime ?? "",
            name: updated.name,
            mimeType: updated.mimeType,
            size: updated.size,
            oldContent,
            newContent: content,
          };
        } catch (err) {
          // When forceRecreate is enabled and the file is 404, recreate it
          if (isNotFoundError(err) && forceRecreate && fileName) {
            try {
              const created = await createFile(
                validTokens.accessToken, fileName, content,
                validTokens.rootFolderId, guessMimeType(fileName),
              );
              return {
                ok: true as const,
                uploaded: true,
                fileId,
                newFileId: created.id,
                md5Checksum: created.md5Checksum ?? "",
                modifiedTime: created.modifiedTime ?? "",
                name: created.name,
                mimeType: created.mimeType,
                size: created.size,
                oldContent: null,
                newContent: content,
              };
            } catch {
              return { ok: false as const, fileId };
            }
          }
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

      type PushSuccess = {
        ok: true;
        uploaded: boolean;
        size?: string;
        fileId: string;
        newFileId?: string;
        md5Checksum: string;
        modifiedTime: string;
        name: string;
        mimeType: string;
        oldContent: string | null;
        newContent: string | null;
      };
      const successful = pushResults.filter((r) => r.ok) as PushSuccess[];
      const skippedFileIds = pushResults.filter((r) => !r.ok).map((r) => r.fileId);
      const actuallyUploaded = successful.filter((r) => r.uploaded);

      // Update meta entries only for files that were actually uploaded
      // For recreated files, use the newFileId as the meta key
      for (const r of actuallyUploaded) {
        const metaFileId = r.newFileId ?? r.fileId;
        const existing = pushRemoteMeta.files[metaFileId];
        pushRemoteMeta.files[metaFileId] = {
          ...existing,
          name: r.name || existing?.name || "",
          mimeType: r.mimeType || existing?.mimeType || "",
          md5Checksum: r.md5Checksum,
          modifiedTime: r.modifiedTime,
          size: r.size ?? existing?.size,
        };
      }

      if (actuallyUploaded.length > 0) {
        // Re-read latest _sync-meta.json to merge entries added by concurrent operations
        // (e.g. usePendingFileMigration creating files while push was in progress)
        const latestMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        if (latestMeta && !forceRecreate) {
          // Merge only files updated by this push. Re-applying the entire client
          // snapshot would resurrect stale entries after concurrent deletes/edits.
          for (const r of actuallyUploaded) {
            const metaFileId = r.newFileId ?? r.fileId;
            const existing = latestMeta.files[metaFileId];
            latestMeta.files[metaFileId] = {
              ...existing,
              name: r.name || existing?.name || "",
              mimeType: r.mimeType || existing?.mimeType || "",
              md5Checksum: r.md5Checksum,
              modifiedTime: r.modifiedTime,
              size: r.size ?? existing?.size,
            };
          }
          latestMeta.lastUpdatedAt = new Date().toISOString();
          if (syncMetaFileId) {
            await updateFile(validTokens.accessToken, syncMetaFileId,
              JSON.stringify(latestMeta, null, 2), "application/json");
          } else {
            await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, latestMeta);
          }
          // Return merged meta so client has the complete picture
          pushRemoteMeta = latestMeta;
        } else {
          pushRemoteMeta.lastUpdatedAt = new Date().toISOString();
          if (syncMetaFileId && !forceRecreate) {
            await updateFile(validTokens.accessToken, syncMetaFileId,
              JSON.stringify(pushRemoteMeta, null, 2), "application/json");
          } else {
            await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, pushRemoteMeta);
          }
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
                newContent: r.newContent!,
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
          newFileId: r.newFileId,
          md5Checksum: r.md5Checksum,
          modifiedTime: r.modifiedTime,
        })),
        skippedFileIds,
        remoteMeta: pushRemoteMeta,
      });
    }

    case "migrateRootFolder": {
      const newRootFolderId = body.newRootFolderId as string;
      const files = body.files as Array<{ fileName: string; content: string }> | undefined;

      if (!newRootFolderId) {
        return logAndReturn({ error: "Missing newRootFolderId" }, { status: 400 });
      }

      // Save cached files to sync_conflicts/ in the new root folder
      if (files && files.length > 0) {
        const newSettings = await getSettings(validTokens.accessToken, newRootFolderId);
        const conflictFolder = newSettings.syncConflictFolder || "sync_conflicts";
        await parallelProcess(files, async ({ fileName, content }) => {
          try {
            await saveConflictBackup(
              validTokens.accessToken,
              newRootFolderId,
              conflictFolder,
              fileName,
              content
            );
          } catch {
            // Best-effort: skip files that fail to save
          }
        }, 5);
      }

      // Update session with new rootFolderId
      const updatedTokens = { ...validTokens, rootFolderId: newRootFolderId };
      const session = await setTokens(request, updatedTokens);
      const cookie = await commitSession(session);
      logCtx.details = { migratedCount: files?.length ?? 0, newRootFolderId };
      emitLog(logCtx, 200);
      return Response.json(
        { success: true, migratedCount: files?.length ?? 0 },
        { headers: { "Set-Cookie": cookie } }
      );
    }

    case "rebuildTree": {
      await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
      return logAndReturn({ success: true, message: "Sync meta rebuilt." });
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
