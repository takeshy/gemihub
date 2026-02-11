import type { Route } from "./+types/api.sync";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
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
import { getOrCreateStore, registerSingleFile, calculateChecksum, deleteSingleFileFromRag } from "~/services/file-search.server";
import { DEFAULT_RAG_SETTING, DEFAULT_RAG_STORE_KEY } from "~/types/settings";
import { saveEdit } from "~/services/edit-history.server";

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

// POST: diff / pull / resolve / pushFiles / fullPush / fullPull / clearConflicts / detectUntracked / deleteUntracked / restoreUntracked
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
    "diff", "pull", "resolve", "fullPush", "fullPull",
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
      const files = await listUserFiles(validTokens.accessToken, validTokens.rootFolderId);
      const diff = computeSyncDiff(localMeta, remoteMeta, files, locallyModifiedIds);
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

    case "fullPush": {
      // Full push: merge all local meta entries into remote meta
      const localMeta = body.localMeta as SyncMeta;

      const remoteMeta =
        (await readRemoteSyncMeta(
          validTokens.accessToken,
          validTokens.rootFolderId
        )) ?? {
          lastUpdatedAt: new Date().toISOString(),
          files: {},
        };

      // Merge all local entries into remote
      for (const [fileId, fileMeta] of Object.entries(localMeta.files)) {
        const existing = remoteMeta.files[fileId];
        remoteMeta.files[fileId] = {
          ...existing,
          ...fileMeta,
          name: fileMeta.name || existing?.name || "",
          mimeType: fileMeta.mimeType || existing?.mimeType || "",
        };
      }
      remoteMeta.lastUpdatedAt = new Date().toISOString();

      await writeRemoteSyncMeta(
        validTokens.accessToken,
        validTokens.rootFolderId,
        remoteMeta
      );

      return jsonWithCookie({ remoteMeta });
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

      // Read sync meta once
      const pushRemoteMeta =
        (await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId))
        ?? { lastUpdatedAt: new Date().toISOString(), files: {} as SyncMeta["files"] };

      // Update files in parallel: read old content (for edit history), then update
      const pushResults = await parallelProcess(files, async ({ fileId, content }) => {
        let oldContent: string | null = null;
        try {
          oldContent = await readFile(validTokens.accessToken, fileId);
        } catch {
          // File might be new or unreadable, skip history
        }

        const existingMeta = pushRemoteMeta.files[fileId];
        const mimeType = existingMeta?.mimeType || "text/plain";
        const updated = await updateFile(validTokens.accessToken, fileId, content, mimeType);

        return {
          fileId,
          md5Checksum: updated.md5Checksum ?? "",
          modifiedTime: updated.modifiedTime ?? "",
          name: updated.name,
          mimeType: updated.mimeType,
          oldContent,
          newContent: content,
        };
      }, 5);

      // Update meta entries from results
      for (const r of pushResults) {
        const existing = pushRemoteMeta.files[r.fileId];
        pushRemoteMeta.files[r.fileId] = {
          ...existing,
          name: r.name || existing?.name || "",
          mimeType: r.mimeType || existing?.mimeType || "",
          md5Checksum: r.md5Checksum,
          modifiedTime: r.modifiedTime,
        };
      }
      pushRemoteMeta.lastUpdatedAt = new Date().toISOString();

      // Write sync meta once
      await writeRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId, pushRemoteMeta);

      // Save remote edit history in background (best-effort, does not block response)
      const historyEntries = pushResults.filter(
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
        results: pushResults.map((r) => ({
          fileId: r.fileId,
          md5Checksum: r.md5Checksum,
          modifiedTime: r.modifiedTime,
        })),
        remoteMeta: pushRemoteMeta,
      });
    }

    case "ragRegister": {
      // Per-file RAG registration during push
      const { content: ragContent, fileName } = body as {
        content: string;
        fileName: string;
      };

      if (ragContent == null || !fileName) {
        return jsonWithCookie({ error: "Missing content or fileName" }, { status: 400 });
      }

      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      const apiKey = validTokens.geminiApiKey;

      // Skip if disabled or no API key
      if (!apiKey || !settings.ragRegistrationOnPush) {
        return jsonWithCookie({ ok: true, skipped: true });
      }

      // Ensure the default "gemihub" RAG setting exists
      const storeKey = DEFAULT_RAG_STORE_KEY;
      let ragSetting = settings.ragSettings[storeKey];
      if (!ragSetting) {
        ragSetting = structuredClone(DEFAULT_RAG_SETTING);
        settings.ragSettings[storeKey] = ragSetting;
      }
      ragSetting.files ??= {};

      // Ensure store exists
      if (!ragSetting.storeName) {
        const storeName = await getOrCreateStore(apiKey, storeKey);
        ragSetting.storeName = storeName;
        ragSetting.storeId = storeName;
        // Save settings to persist store name (one-time)
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
      }

      // Skip if content unchanged (checksum match)
      const existing = ragSetting.files[fileName];
      if (existing) {
        const newChecksum = await calculateChecksum(ragContent);
        if (existing.checksum === newChecksum) {
          return jsonWithCookie({ ok: true, skipped: true });
        }
      }

      // Register the file
      const result = await registerSingleFile(
        apiKey,
        ragSetting.storeName,
        fileName,
        ragContent,
        existing?.fileId ?? null
      );

      const ragFileInfo = {
        checksum: result.checksum,
        uploadedAt: Date.now(),
        fileId: result.fileId,
      };

      return jsonWithCookie({
        ok: true,
        ragFileInfo,
        storeName: ragSetting.storeName,
      });
    }

    case "ragSave": {
      // Batch save RAG tracking info after push completes
      const { updates, storeName: ragStoreName } = body as {
        updates: Array<{ fileName: string; ragFileInfo: { checksum: string; uploadedAt: number; fileId: string | null; status: "registered" | "pending" } }>;
        storeName: string;
      };

      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      const storeKey = DEFAULT_RAG_STORE_KEY;
      let ragSetting = settings.ragSettings[storeKey];
      if (!ragSetting) {
        ragSetting = structuredClone(DEFAULT_RAG_SETTING);
        if (ragStoreName) {
          ragSetting.storeName = ragStoreName;
          ragSetting.storeId = ragStoreName;
          ragSetting.storeIds = [ragStoreName];
        }
        settings.ragSettings[storeKey] = ragSetting;
      }
      ragSetting.files ??= {};

      // Enable RAG if we have newly registered (not just pending) files
      if (updates.some((u) => u.ragFileInfo.status === "registered")) {
        settings.ragEnabled = true;
        if (!settings.selectedRagSetting) {
          settings.selectedRagSetting = storeKey;
        }
      }

      for (const { fileName, ragFileInfo } of updates) {
        // Don't overwrite existing registered entries with empty-checksum pending
        // (initial pending-first save should not destroy checksum/fileId)
        const existing = ragSetting.files[fileName];
        if (
          ragFileInfo.status === "pending" &&
          !ragFileInfo.checksum &&
          existing?.status === "registered"
        ) {
          continue;
        }
        ragSetting.files[fileName] = ragFileInfo;
      }

      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
      const pendingCount = Object.values(ragSetting.files).filter((f) => f.status === "pending").length;
      return jsonWithCookie({ ok: true, pendingCount });
    }

    case "ragDeleteDoc": {
      const { documentId } = body as { documentId: string };
      if (!documentId) {
        return jsonWithCookie({ error: "Missing documentId" }, { status: 400 });
      }
      const apiKey = validTokens.geminiApiKey;
      if (!apiKey) {
        return jsonWithCookie({ ok: false, skipped: true, reason: "no-api-key" });
      }
      const ok = await deleteSingleFileFromRag(apiKey, documentId);
      return jsonWithCookie({ ok });
    }

    case "ragRetryPending": {
      const retryApiKey = validTokens.geminiApiKey;
      if (!retryApiKey) {
        return jsonWithCookie({ ok: false, skipped: true, reason: "no-api-key" });
      }

      const retrySettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      if (!retrySettings.ragRegistrationOnPush) {
        return jsonWithCookie({ ok: true, retried: 0, stillPending: 0 });
      }

      const retryStoreKey = DEFAULT_RAG_STORE_KEY;
      const retryRagSetting = retrySettings.ragSettings[retryStoreKey];
      if (!retryRagSetting?.storeName || !retryRagSetting.files) {
        return jsonWithCookie({ ok: true, retried: 0, stillPending: 0 });
      }

      // Find pending entries
      const pendingEntries = Object.entries(retryRagSetting.files).filter(
        ([, info]) => info.status === "pending"
      );
      if (pendingEntries.length === 0) {
        return jsonWithCookie({ ok: true, retried: 0, stillPending: 0 });
      }

      // Resolve file names to Drive file IDs via sync meta
      const retryRemoteMeta = await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
      const nameToFileId: Record<string, string> = {};
      for (const [fileId, fileMeta] of Object.entries(retryRemoteMeta.files)) {
        nameToFileId[fileMeta.name] = fileId;
      }

      let retriedCount = 0;
      let stillPendingCount = 0;

      for (const [fileName, info] of pendingEntries) {
        const driveFileId = nameToFileId[fileName];
        if (!driveFileId) {
          // File no longer exists on Drive, remove from tracking
          delete retryRagSetting.files[fileName];
          continue;
        }

        try {
          const content = await readFile(validTokens.accessToken, driveFileId);
          const result = await registerSingleFile(
            retryApiKey,
            retryRagSetting.storeName,
            fileName,
            content,
            info.fileId
          );
          retryRagSetting.files[fileName] = {
            checksum: result.checksum,
            uploadedAt: Date.now(),
            fileId: result.fileId,
            status: "registered",
          };
          retriedCount++;
        } catch {
          // Still pending
          stillPendingCount++;
        }
      }

      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, retrySettings);
      return jsonWithCookie({ ok: true, retried: retriedCount, stillPending: stillPendingCount });
    }

    default:
      return jsonWithCookie({ error: "Unknown action" }, { status: 400 });
  }
}
