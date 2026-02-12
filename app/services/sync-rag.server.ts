import { getSettings, saveSettings } from "~/services/user-settings.server";
import { readFileBytes } from "~/services/google-drive.server";
import { getOrCreateStore, registerSingleFile, calculateChecksum, deleteSingleFileFromRag } from "~/services/file-search.server";
import { rebuildSyncMeta } from "~/services/sync-meta.server";
import { DEFAULT_RAG_SETTING, DEFAULT_RAG_STORE_KEY } from "~/types/settings";

type RagActionType = "ragRegister" | "ragSave" | "ragDeleteDoc" | "ragRetryPending";

type RagActionContext = {
  validTokens: {
    accessToken: string;
    rootFolderId: string;
    geminiApiKey?: string | null;
  };
  jsonWithCookie: (data: unknown, init?: ResponseInit) => Response;
};

export type RagDeps = {
  getSettings: typeof getSettings;
  saveSettings: typeof saveSettings;
  getOrCreateStore: typeof getOrCreateStore;
  registerSingleFile: typeof registerSingleFile;
  calculateChecksum: typeof calculateChecksum;
  deleteSingleFileFromRag: typeof deleteSingleFileFromRag;
  readFileBytes: typeof readFileBytes;
  rebuildSyncMeta: typeof rebuildSyncMeta;
};

export const defaultRagDeps: RagDeps = {
  getSettings,
  saveSettings,
  getOrCreateStore,
  registerSingleFile,
  calculateChecksum,
  deleteSingleFileFromRag,
  readFileBytes,
  rebuildSyncMeta,
};

export async function handleRagAction(
  actionType: RagActionType,
  body: unknown,
  context: RagActionContext,
  deps: RagDeps = defaultRagDeps
): Promise<Response> {
  const { validTokens, jsonWithCookie } = context;

  switch (actionType) {
    case "ragRegister": {
      // Per-file RAG registration during push or file creation
      const { content: ragContent, fileName, fileId } = body as {
        content?: string;
        fileName?: string;
        fileId?: string;
      };

      if (!fileName) {
        return jsonWithCookie({ error: "Missing fileName" }, { status: 400 });
      }

      const settings = await deps.getSettings(validTokens.accessToken, validTokens.rootFolderId);
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

      // Skip if file matches exclude patterns
      const excludePatterns = ragSetting.excludePatterns || [];
      if (excludePatterns.some((p) => new RegExp(p).test(fileName))) {
        return jsonWithCookie({ ok: true, skipped: true });
      }

      // Ensure store exists
      if (!ragSetting.storeName) {
        const storeName = await deps.getOrCreateStore(apiKey, storeKey);
        ragSetting.storeName = storeName;
        ragSetting.storeId = storeName;
        // Save settings to persist store name (one-time)
        await deps.saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
      }

      let uploadContent: string | Uint8Array;
      if (fileId) {
        try {
          uploadContent = await deps.readFileBytes(validTokens.accessToken, fileId);
        } catch (error) {
          if (ragContent == null) {
            return jsonWithCookie(
              { error: error instanceof Error ? error.message : "Failed to read file bytes" },
              { status: 500 }
            );
          }
          uploadContent = ragContent;
        }
      } else if (ragContent != null) {
        uploadContent = ragContent;
      } else {
        return jsonWithCookie({ error: "Missing content or fileId" }, { status: 400 });
      }

      // Skip if content unchanged (checksum match)
      const existing = ragSetting.files[fileName];
      const newChecksum = await deps.calculateChecksum(uploadContent);
      if (existing && existing.checksum === newChecksum) {
        return jsonWithCookie({ ok: true, skipped: true });
      }

      // Register the file
      const result = await deps.registerSingleFile(
        apiKey,
        ragSetting.storeName,
        fileName,
        uploadContent,
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

      const settings = await deps.getSettings(validTokens.accessToken, validTokens.rootFolderId);
      if (!settings.ragRegistrationOnPush) {
        return jsonWithCookie({ ok: true, pendingCount: 0, skipped: true });
      }
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

      await deps.saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
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
      const ok = await deps.deleteSingleFileFromRag(apiKey, documentId);
      return jsonWithCookie({ ok });
    }

    case "ragRetryPending": {
      const retryApiKey = validTokens.geminiApiKey;
      if (!retryApiKey) {
        return jsonWithCookie({ ok: false, skipped: true, reason: "no-api-key" });
      }

      const retrySettings = await deps.getSettings(validTokens.accessToken, validTokens.rootFolderId);
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
      const retryRemoteMeta = await deps.rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
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
          const content = await deps.readFileBytes(validTokens.accessToken, driveFileId);
          const result = await deps.registerSingleFile(
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

      await deps.saveSettings(validTokens.accessToken, validTokens.rootFolderId, retrySettings);
      return jsonWithCookie({ ok: true, retried: retriedCount, stillPending: stillPendingCount });
    }

    default:
      return jsonWithCookie({ error: "Unknown action" }, { status: 400 });
  }
}
