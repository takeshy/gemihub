import type { Route } from "./+types/api.sync";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import {
  listUserFiles,
  readFile,
  getFileMetadata,
  deleteFile,
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

// GET: Fetch remote sync meta + current file list
export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };

  // Rebuild meta from Drive API to ensure accurate state for sync
  const remoteMeta = await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);

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

// POST: diff / push / pull / resolve / fullPush / fullPull / clearConflicts / detectUntracked / deleteUntracked / restoreUntracked
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

  switch (actionType) {
    case "diff": {
      const localMeta = body.localMeta as SyncMeta | null;
      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      // Rebuild meta from Drive API to get accurate current state
      const remoteMeta = await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
      const files = await listUserFiles(validTokens.accessToken, validTokens.rootFolderId);
      const diff = computeSyncDiff(localMeta, remoteMeta, files, settings.syncExcludePatterns);
      return jsonWithCookie({ diff, remoteMeta });
    }

    case "push": {
      // Update remote meta with the provided local meta for specified file IDs
      const fileIds = body.fileIds as string[];
      const localMeta = body.localMeta as SyncMeta;

      const remoteMeta =
        (await readRemoteSyncMeta(
          validTokens.accessToken,
          validTokens.rootFolderId
        )) ?? {
          lastUpdatedAt: new Date().toISOString(),
          files: {},
        };

      // Update remote meta entries for pushed files (merge to preserve name/mimeType)
      for (const fileId of fileIds) {
        if (localMeta.files[fileId]) {
          const existing = remoteMeta.files[fileId];
          remoteMeta.files[fileId] = {
            ...existing,
            ...localMeta.files[fileId],
            // Ensure name/mimeType are preserved from existing if not in localMeta
            name: localMeta.files[fileId].name || existing?.name || "",
            mimeType: localMeta.files[fileId].mimeType || existing?.mimeType || "",
          };
        }
      }
      remoteMeta.lastUpdatedAt = new Date().toISOString();

      await writeRemoteSyncMeta(
        validTokens.accessToken,
        validTokens.rootFolderId,
        remoteMeta
      );

      return jsonWithCookie({ remoteMeta });
    }

    case "pull": {
      // Return file contents + metadata for specified file IDs (parallelized)
      const fileIds = body.fileIds as string[];

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
        };
      }, 5);

      return jsonWithCookie({ files: results });
    }

    case "resolve": {
      // Resolve a conflict by choosing local or remote
      const { fileId, choice, localContent } = body as {
        fileId: string;
        choice: "local" | "remote";
        localContent?: string;
      };

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
        const localMeta = body.localMeta as SyncMeta;
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
        if (localMeta?.files[fileId]) {
          remoteMeta.files[fileId] = localMeta.files[fileId];
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

      // If remote wins, return the file content
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

      return jsonWithCookie({ remoteMeta });
    }

    case "fullPull": {
      // Full pull: rebuild meta, download all files (skip matching hashes)
      const skipHashes = (body.skipHashes ?? {}) as Record<string, string>;
      const remoteMeta = await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);

      const fileEntries = Object.entries(remoteMeta.files).filter(
        ([id, f]) => f.name !== "_sync-meta.json" && f.name !== "settings.json"
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
      let remoteMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId)
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

    default:
      return jsonWithCookie({ error: "Unknown action" }, { status: 400 });
  }
}
