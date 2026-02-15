import assert from "node:assert/strict";
import test from "node:test";
import { handleRagAction } from "~/services/sync-rag.server";
import { DEFAULT_RAG_SETTING, DEFAULT_RAG_STORE_KEY } from "~/types/settings";

test("ragRegister -> ragSave -> ragRetryPending uses bytes", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = {
    ragRegistrationOnPush: true,
    ragSettings: {},
    ragEnabled: false,
    selectedRagSetting: null,
  };

  const capturedContents: Array<unknown> = [];
  const deps = {
    getSettings: async () => settings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveSettings: async (_accessToken: string, _rootFolderId: string, next: any) => {
      Object.assign(settings, next);
    },
    getOrCreateStore: async () => "stores/test",
    registerSingleFile: async (
      _apiKey: string,
      _storeName: string,
      _fileName: string,
      content: unknown
    ) => {
      capturedContents.push(content);
      return { checksum: "chk", fileId: "doc1" };
    },
    calculateChecksum: async (_content: unknown) => "chk",
    deleteSingleFileFromRag: async () => true,
    readFileBytes: async () => new Uint8Array([1, 2, 3, 4]),
    rebuildSyncMeta: async () => ({
      lastUpdatedAt: new Date().toISOString(),
      files: {
        file999: {
          name: "pending.pdf",
          mimeType: "application/pdf",
          md5Checksum: "",
          modifiedTime: new Date().toISOString(),
        },
      },
    }),
  };

  const validTokens = {
    accessToken: "token",
    rootFolderId: "root",
    geminiApiKey: "api-key",
  };

  const jsonWithCookie = (data: unknown, init?: ResponseInit) => Response.json(data, init);

  const registerResponse = await handleRagAction(
    "ragRegister",
    { action: "ragRegister", fileId: "file123", fileName: "doc.pdf", content: "text" },
    { validTokens, jsonWithCookie },
    deps
  );
  const registerData = await registerResponse.json();
  assert.equal(registerData.ok, true);
  assert.ok(capturedContents[0] instanceof Uint8Array);

  const saveResponse = await handleRagAction(
    "ragSave",
    {
      action: "ragSave",
      updates: [
        {
          fileName: "pending.pdf",
          ragFileInfo: { checksum: "", uploadedAt: Date.now(), fileId: null, status: "pending" },
        },
      ],
      storeName: "stores/test",
    },
    { validTokens, jsonWithCookie },
    deps
  );
  const saveData = await saveResponse.json();
  assert.equal(saveData.ok, true);

  const retryResponse = await handleRagAction(
    "ragRetryPending",
    { action: "ragRetryPending" },
    { validTokens, jsonWithCookie },
    deps
  );
  const retryData = await retryResponse.json();
  assert.equal(retryData.retried, 1);
  assert.ok(capturedContents[1] instanceof Uint8Array);

  const ragSetting = settings.ragSettings[DEFAULT_RAG_STORE_KEY] ?? { ...DEFAULT_RAG_SETTING };
  assert.equal(ragSetting.files["pending.pdf"].status, "registered");
});

test("ragRegister skips ineligible extension on server side", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = {
    ragRegistrationOnPush: true,
    ragSettings: {},
    ragEnabled: false,
    selectedRagSetting: null,
  };

  let registerCalls = 0;
  const deps = {
    getSettings: async () => settings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveSettings: async (_accessToken: string, _rootFolderId: string, next: any) => {
      Object.assign(settings, next);
    },
    getOrCreateStore: async () => "stores/test",
    registerSingleFile: async () => {
      registerCalls++;
      return { checksum: "chk", fileId: "doc1" };
    },
    calculateChecksum: async () => "chk",
    deleteSingleFileFromRag: async () => true,
    readFileBytes: async () => new Uint8Array([1, 2, 3, 4]),
    rebuildSyncMeta: async () => ({ lastUpdatedAt: new Date().toISOString(), files: {} }),
  };

  const validTokens = {
    accessToken: "token",
    rootFolderId: "root",
    geminiApiKey: "api-key",
  };
  const jsonWithCookie = (data: unknown, init?: ResponseInit) => Response.json(data, init);

  const response = await handleRagAction(
    "ragRegister",
    { action: "ragRegister", fileId: "file123", fileName: "image.png" },
    { validTokens, jsonWithCookie },
    deps
  );
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.skipped, true);
  assert.equal(data.reason, "ineligible-extension");
  assert.equal(registerCalls, 0);
});

test("excluded pending entries are cleaned and never retried", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = {
    ragRegistrationOnPush: true,
    ragSettings: {
      [DEFAULT_RAG_STORE_KEY]: {
        ...DEFAULT_RAG_SETTING,
        storeName: "stores/test",
        storeId: "stores/test",
        files: {},
      },
    },
    ragEnabled: false,
    selectedRagSetting: null,
  };

  let registerCalls = 0;
  const deletedDocIds: string[] = [];
  const deps = {
    getSettings: async () => settings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveSettings: async (_accessToken: string, _rootFolderId: string, next: any) => {
      Object.assign(settings, next);
    },
    getOrCreateStore: async () => "stores/test",
    registerSingleFile: async () => {
      registerCalls++;
      return { checksum: "chk", fileId: "doc1" };
    },
    calculateChecksum: async () => "chk",
    deleteSingleFileFromRag: async (_apiKey: string, documentId: string) => {
      deletedDocIds.push(documentId);
      return true;
    },
    readFileBytes: async () => new Uint8Array([1, 2, 3, 4]),
    rebuildSyncMeta: async () => ({
      lastUpdatedAt: new Date().toISOString(),
      files: {
        file1: {
          name: "workflows/auto.yaml",
          mimeType: "text/yaml",
          md5Checksum: "",
          modifiedTime: new Date().toISOString(),
        },
      },
    }),
  };

  const validTokens = {
    accessToken: "token",
    rootFolderId: "root",
    geminiApiKey: "api-key",
  };
  const jsonWithCookie = (data: unknown, init?: ResponseInit) => Response.json(data, init);

  // Simulate old client behavior that wrote pending for excluded paths.
  settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["workflows/auto.yaml"] = {
    checksum: "old-checksum",
    uploadedAt: Date.now(),
    fileId: "doc-existing",
    status: "registered",
  };
  const saveResponse = await handleRagAction(
    "ragSave",
    {
      action: "ragSave",
      updates: [
        {
          fileName: "workflows/auto.yaml",
          ragFileInfo: { checksum: "", uploadedAt: Date.now(), fileId: null, status: "pending" },
        },
      ],
      storeName: "stores/test",
    },
    { validTokens, jsonWithCookie },
    deps
  );
  const saveData = await saveResponse.json();
  assert.equal(saveData.ok, true);
  assert.equal(saveData.pendingCount, 0);
  assert.equal(settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["workflows/auto.yaml"], undefined);
  assert.ok(deletedDocIds.includes("doc-existing"));

  // Simulate legacy stale pending entry and verify retry removes it without upload.
  settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["workflows/auto.yaml"] = {
    checksum: "",
    uploadedAt: Date.now(),
    fileId: "doc-old",
    status: "pending",
  };

  const retryResponse = await handleRagAction(
    "ragRetryPending",
    { action: "ragRetryPending" },
    { validTokens, jsonWithCookie },
    deps
  );
  const retryData = await retryResponse.json();
  assert.equal(retryData.ok, true);
  assert.equal(retryData.retried, 0);
  assert.equal(retryData.stillPending, 0);
  assert.equal(registerCalls, 0);
  assert.equal(settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["workflows/auto.yaml"], undefined);
  assert.ok(deletedDocIds.includes("doc-old"));
});

test("ragSave keeps excluded tracking as pending when remote delete fails", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = {
    ragRegistrationOnPush: true,
    ragSettings: {
      [DEFAULT_RAG_STORE_KEY]: {
        ...DEFAULT_RAG_SETTING,
        storeName: "stores/test",
        storeId: "stores/test",
        files: {
          "workflows/plan.yaml": {
            checksum: "old-checksum",
            uploadedAt: Date.now(),
            fileId: "doc-existing",
            status: "registered",
          },
        },
      },
    },
    ragEnabled: true,
    selectedRagSetting: DEFAULT_RAG_STORE_KEY,
  };

  const deps = {
    getSettings: async () => settings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveSettings: async (_accessToken: string, _rootFolderId: string, next: any) => {
      Object.assign(settings, next);
    },
    getOrCreateStore: async () => "stores/test",
    registerSingleFile: async () => ({ checksum: "chk", fileId: "doc1" }),
    calculateChecksum: async () => "chk",
    deleteSingleFileFromRag: async () => false,
    readFileBytes: async () => new Uint8Array([1, 2, 3, 4]),
    rebuildSyncMeta: async () => ({ lastUpdatedAt: new Date().toISOString(), files: {} }),
  };

  const validTokens = {
    accessToken: "token",
    rootFolderId: "root",
    geminiApiKey: "api-key",
  };
  const jsonWithCookie = (data: unknown, init?: ResponseInit) => Response.json(data, init);

  const saveResponse = await handleRagAction(
    "ragSave",
    {
      action: "ragSave",
      updates: [
        {
          fileName: "workflows/plan.yaml",
          ragFileInfo: { checksum: "", uploadedAt: Date.now(), fileId: null, status: "pending" },
        },
      ],
      storeName: "stores/test",
    },
    { validTokens, jsonWithCookie },
    deps
  );
  const saveData = await saveResponse.json();
  assert.equal(saveData.ok, true);
  assert.equal(saveData.pendingCount, 1);
  assert.equal(settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["workflows/plan.yaml"]?.status, "pending");
  assert.equal(settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["workflows/plan.yaml"]?.fileId, "doc-existing");
});

test("ragRetryPending includes excluded registered entries and keeps them pending when delete fails", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = {
    ragRegistrationOnPush: true,
    ragSettings: {
      [DEFAULT_RAG_STORE_KEY]: {
        ...DEFAULT_RAG_SETTING,
        storeName: "stores/test",
        storeId: "stores/test",
        files: {
          "workflows/legacy.yaml": {
            checksum: "old-checksum",
            uploadedAt: Date.now(),
            fileId: "doc-legacy",
            status: "registered",
          },
        },
      },
    },
    ragEnabled: true,
    selectedRagSetting: DEFAULT_RAG_STORE_KEY,
  };

  const deps = {
    getSettings: async () => settings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveSettings: async (_accessToken: string, _rootFolderId: string, next: any) => {
      Object.assign(settings, next);
    },
    getOrCreateStore: async () => "stores/test",
    registerSingleFile: async () => ({ checksum: "chk", fileId: "doc1" }),
    calculateChecksum: async () => "chk",
    deleteSingleFileFromRag: async () => false,
    readFileBytes: async () => new Uint8Array([1, 2, 3, 4]),
    rebuildSyncMeta: async () => ({
      lastUpdatedAt: new Date().toISOString(),
      files: {
        file1: {
          name: "workflows/legacy.yaml",
          mimeType: "text/yaml",
          md5Checksum: "",
          modifiedTime: new Date().toISOString(),
        },
      },
    }),
  };

  const validTokens = {
    accessToken: "token",
    rootFolderId: "root",
    geminiApiKey: "api-key",
  };
  const jsonWithCookie = (data: unknown, init?: ResponseInit) => Response.json(data, init);

  const retryResponse = await handleRagAction(
    "ragRetryPending",
    { action: "ragRetryPending" },
    { validTokens, jsonWithCookie },
    deps
  );
  const retryData = await retryResponse.json();
  assert.equal(retryData.ok, true);
  assert.equal(retryData.retried, 0);
  assert.equal(retryData.stillPending, 1);
  assert.equal(settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["workflows/legacy.yaml"]?.status, "pending");
  assert.equal(settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["workflows/legacy.yaml"]?.fileId, "doc-legacy");
});

test("ragSave does not overwrite pending fileId with null pending update", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = {
    ragRegistrationOnPush: true,
    ragSettings: {
      [DEFAULT_RAG_STORE_KEY]: {
        ...DEFAULT_RAG_SETTING,
        storeName: "stores/test",
        storeId: "stores/test",
        files: {
          "docs/spec.md": {
            checksum: "",
            uploadedAt: Date.now() - 1000,
            fileId: "doc-existing",
            status: "pending",
          },
        },
      },
    },
    ragEnabled: true,
    selectedRagSetting: DEFAULT_RAG_STORE_KEY,
  };

  const deps = {
    getSettings: async () => settings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveSettings: async (_accessToken: string, _rootFolderId: string, next: any) => {
      Object.assign(settings, next);
    },
    getOrCreateStore: async () => "stores/test",
    registerSingleFile: async () => ({ checksum: "chk", fileId: "doc1" }),
    calculateChecksum: async () => "chk",
    deleteSingleFileFromRag: async () => true,
    readFileBytes: async () => new Uint8Array([1, 2, 3, 4]),
    rebuildSyncMeta: async () => ({ lastUpdatedAt: new Date().toISOString(), files: {} }),
  };

  const validTokens = {
    accessToken: "token",
    rootFolderId: "root",
    geminiApiKey: "api-key",
  };
  const jsonWithCookie = (data: unknown, init?: ResponseInit) => Response.json(data, init);

  const saveResponse = await handleRagAction(
    "ragSave",
    {
      action: "ragSave",
      updates: [
        {
          fileName: "docs/spec.md",
          ragFileInfo: { checksum: "", uploadedAt: Date.now(), fileId: null, status: "pending" },
        },
      ],
      storeName: "stores/test",
    },
    { validTokens, jsonWithCookie },
    deps
  );
  const saveData = await saveResponse.json();
  assert.equal(saveData.ok, true);
  assert.equal(settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["docs/spec.md"]?.status, "pending");
  assert.equal(settings.ragSettings[DEFAULT_RAG_STORE_KEY].files["docs/spec.md"]?.fileId, "doc-existing");
});
