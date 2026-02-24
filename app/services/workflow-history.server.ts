import {
  getHistoryFolderId,
  ensureSubFolder,
  listFiles,
  readFile,
  createFile,
  updateFile,
  deleteFile,
} from "./google-drive.server";
import {
  readHistoryMeta,
  rebuildHistoryMeta,
  upsertHistoryMetaEntry,
  removeHistoryMetaEntry,
} from "./history-meta.server";
import type { ExecutionRecord, ExecutionRecordItem } from "~/engine/types";
import type { EncryptionParams } from "~/types/settings";
import { encryptFileContent, isEncryptedFile } from "./crypto.server";

const EXEC_HISTORY_FOLDER = "execution";

async function ensureExecHistoryFolderId(
  accessToken: string,
  rootFolderId: string
): Promise<string> {
  const historyFolderId = await getHistoryFolderId(accessToken, rootFolderId);
  return ensureSubFolder(accessToken, historyFolderId, EXEC_HISTORY_FOLDER);
}

/** Extract ExecutionRecordItem metadata from a parsed execution record */
function extractExecItem(
  fileId: string,
  content: unknown
): ExecutionRecordItem | null {
  const obj = content as Record<string, unknown>;
  if (obj.__encrypted) {
    const fileName = obj.fileName as string;
    const match = fileName.match(/^exec_(.+)\.json$/);
    if (!match) return null;
    return {
      id: match[1],
      fileId,
      workflowId: "",
      startTime: "",
      status: "completed",
      stepCount: 0,
      isEncrypted: true,
    };
  }
  const record = content as ExecutionRecord;
  if (!record.id) return null;
  return {
    id: record.id,
    fileId,
    workflowId: record.workflowId,
    workflowName: record.workflowName,
    startTime: record.startTime,
    endTime: record.endTime,
    status: record.status,
    stepCount: record.steps?.length || 0,
  };
}

export async function saveExecutionRecord(
  accessToken: string,
  rootFolderId: string,
  record: ExecutionRecord,
  encryption?: EncryptionParams
): Promise<string> {
  const folderId = await ensureExecHistoryFolderId(accessToken, rootFolderId);
  let content = JSON.stringify(record, null, 2);
  if (encryption) {
    content = await encryptFileContent(
      content,
      encryption.publicKey,
      encryption.encryptedPrivateKey,
      encryption.salt
    );
  }
  const fileName = `exec_${record.id}.json`;

  const files = await listFiles(accessToken, folderId);
  const existing = files.find((f) => f.name === fileName);

  let fileId: string;
  if (existing) {
    await updateFile(accessToken, existing.id, content, "application/json");
    fileId = existing.id;
  } else {
    const file = await createFile(
      accessToken,
      fileName,
      content,
      folderId,
      "application/json"
    );
    fileId = file.id;
  }

  // Update _meta.json (best-effort)
  try {
    const item: ExecutionRecordItem = {
      id: record.id,
      fileId,
      workflowId: record.workflowId,
      workflowName: record.workflowName,
      startTime: record.startTime,
      endTime: record.endTime,
      status: record.status,
      stepCount: record.steps?.length || 0,
      isEncrypted: !!encryption,
    };
    await upsertHistoryMetaEntry(accessToken, folderId, fileId, item);
  } catch (err) {
    console.error("[workflow-history] Failed to update _meta.json:", err);
  }

  // Strip variablesSnapshot from older records to save storage (best-effort)
  stripOldSnapshots(accessToken, folderId, fileId, fileName, record.workflowId).catch((err) => {
    console.error("[workflow-history] Failed to strip old snapshots:", err);
  });

  return fileId;
}

export async function listExecutionRecords(
  accessToken: string,
  rootFolderId: string,
  workflowId?: string
): Promise<ExecutionRecordItem[]> {
  const folderId = await ensureExecHistoryFolderId(accessToken, rootFolderId);

  // Try reading from _meta.json first
  let meta = await readHistoryMeta<ExecutionRecordItem>(accessToken, folderId);
  if (!meta) {
    // Rebuild from individual files (first time or missing _meta.json)
    meta = await rebuildHistoryMeta<ExecutionRecordItem>(
      accessToken,
      folderId,
      extractExecItem
    );
  }

  let items = Object.values(meta.items);

  if (workflowId) {
    items = items.filter((item) => item.workflowId === workflowId);
  }

  items.sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );
  return items;
}

export async function loadExecutionRecord(
  accessToken: string,
  fileId: string
): Promise<ExecutionRecord | { encrypted: true; encryptedContent: string }> {
  const content = await readFile(accessToken, fileId);
  if (isEncryptedFile(content)) {
    return { encrypted: true, encryptedContent: content };
  }
  return JSON.parse(content) as ExecutionRecord;
}

/**
 * Strip variablesSnapshot from older execution records for the same workflow.
 * Skips encrypted files and records for different workflows.
 */
async function stripOldSnapshots(
  accessToken: string,
  folderId: string,
  excludeFileId: string,
  excludeFileName: string,
  workflowId: string
): Promise<void> {
  const files = await listFiles(accessToken, folderId);
  const candidates = files.filter(
    (f) =>
      f.id !== excludeFileId &&
      f.name !== excludeFileName &&
      f.name.startsWith("exec_") &&
      f.name.endsWith(".json") &&
      f.name !== "_meta.json"
  );

  for (const file of candidates) {
    try {
      const content = await readFile(accessToken, file.id);
      if (isEncryptedFile(content)) continue;

      const record = JSON.parse(content) as ExecutionRecord;
      if (record.workflowId !== workflowId) continue;

      const hasSnapshots = record.steps?.some((s) => s.variablesSnapshot);
      if (!hasSnapshots) continue;

      for (const step of record.steps) {
        delete step.variablesSnapshot;
      }
      await updateFile(
        accessToken,
        file.id,
        JSON.stringify(record, null, 2),
        "application/json"
      );
    } catch {
      // Skip files that can't be processed
    }
  }
}

export async function deleteExecutionRecord(
  accessToken: string,
  rootFolderId: string,
  fileId: string
): Promise<void> {
  await deleteFile(accessToken, fileId);

  // Update _meta.json (best-effort)
  try {
    const folderId = await ensureExecHistoryFolderId(accessToken, rootFolderId);
    await removeHistoryMetaEntry(accessToken, folderId, fileId);
  } catch (err) {
    console.error("[workflow-history] Failed to update _meta.json after delete:", err);
  }
}
