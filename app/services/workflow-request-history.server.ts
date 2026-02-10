import {
  getHistoryFolderId,
  ensureSubFolder,
  readFile,
  createFile,
  deleteFile,
} from "./google-drive.server";
import {
  readHistoryMeta,
  rebuildHistoryMeta,
  upsertHistoryMetaEntry,
  removeHistoryMetaEntry,
} from "./history-meta.server";
import type {
  WorkflowRequestRecord,
  WorkflowRequestRecordItem,
} from "~/engine/types";
import type { EncryptionParams } from "~/types/settings";
import { encryptFileContent, isEncryptedFile } from "./crypto.server";

const REQUEST_HISTORY_FOLDER = "requests";

async function ensureRequestHistoryFolderId(
  accessToken: string,
  rootFolderId: string
): Promise<string> {
  const historyFolderId = await getHistoryFolderId(accessToken, rootFolderId);
  return ensureSubFolder(accessToken, historyFolderId, REQUEST_HISTORY_FOLDER);
}

/** Extract WorkflowRequestRecordItem metadata from a parsed request record */
function extractRequestItem(
  fileId: string,
  content: unknown
): WorkflowRequestRecordItem | null {
  const record = content as WorkflowRequestRecord;
  if (!record.id) return null;
  return {
    id: record.id,
    fileId,
    workflowId: record.workflowId,
    workflowName: record.workflowName,
    createdAt: record.createdAt,
    description: record.description,
    model: record.model,
    mode: record.mode,
  };
}

export async function saveRequestRecord(
  accessToken: string,
  rootFolderId: string,
  record: WorkflowRequestRecord,
  encryption?: EncryptionParams
): Promise<string> {
  const folderId = await ensureRequestHistoryFolderId(accessToken, rootFolderId);
  let content = JSON.stringify(record, null, 2);
  if (encryption) {
    content = await encryptFileContent(
      content,
      encryption.publicKey,
      encryption.encryptedPrivateKey,
      encryption.salt
    );
  }
  const fileName = `req_${record.id}.json`;

  const file = await createFile(
    accessToken,
    fileName,
    content,
    folderId,
    "application/json"
  );

  // Update _meta.json (best-effort)
  try {
    const item: WorkflowRequestRecordItem = {
      id: record.id,
      fileId: file.id,
      workflowId: record.workflowId,
      workflowName: record.workflowName,
      createdAt: record.createdAt,
      description: record.description,
      model: record.model,
      mode: record.mode,
      isEncrypted: !!encryption,
    };
    await upsertHistoryMetaEntry(accessToken, folderId, file.id, item);
  } catch (err) {
    console.error("[workflow-request-history] Failed to update _meta.json:", err);
  }

  return file.id;
}

export async function listRequestRecords(
  accessToken: string,
  rootFolderId: string,
  workflowId?: string
): Promise<WorkflowRequestRecordItem[]> {
  const folderId = await ensureRequestHistoryFolderId(accessToken, rootFolderId);

  // Try reading from _meta.json first
  let meta = await readHistoryMeta<WorkflowRequestRecordItem>(accessToken, folderId);
  if (!meta) {
    // Rebuild from individual files (first time or missing _meta.json)
    meta = await rebuildHistoryMeta<WorkflowRequestRecordItem>(
      accessToken,
      folderId,
      extractRequestItem
    );
  }

  let items = Object.values(meta.items);

  if (workflowId) {
    items = items.filter((item) => item.workflowId === workflowId);
  }

  items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return items;
}

export async function loadRequestRecord(
  accessToken: string,
  fileId: string
): Promise<WorkflowRequestRecord | { encrypted: true; encryptedContent: string }> {
  const content = await readFile(accessToken, fileId);
  if (isEncryptedFile(content)) {
    return { encrypted: true, encryptedContent: content };
  }
  return JSON.parse(content) as WorkflowRequestRecord;
}

export async function deleteRequestRecord(
  accessToken: string,
  rootFolderId: string,
  fileId: string
): Promise<void> {
  await deleteFile(accessToken, fileId);

  // Update _meta.json (best-effort)
  try {
    const folderId = await ensureRequestHistoryFolderId(accessToken, rootFolderId);
    await removeHistoryMetaEntry(accessToken, folderId, fileId);
  } catch (err) {
    console.error("[workflow-request-history] Failed to update _meta.json after delete:", err);
  }
}
