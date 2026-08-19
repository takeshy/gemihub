// Workflow execution-history CRUD on tenant GCS.
//
// Each record is stored at `gemihub/history/execution/exec_{id}.json`. The
// public `fileId` slot — kept for shape compatibility with the legacy
// Drive-backed route — is just the record id; treat it as opaque.

import {
  GcsObjectNotFoundError,
  deleteObject,
  listObjects,
  readObject,
  writeObject,
} from "./gcs-storage.server";
import type { ProjectAccessContext } from "~/types/enterprise";
import type { ExecutionRecord, ExecutionRecordItem } from "~/engine/types";
import type { EncryptionParams } from "~/types/settings";
import { encryptFileContent, isEncryptedFile } from "./crypto.server";

const EXEC_PREFIX = "gemihub/history/execution";

function pathFor(id: string): string {
  return `${EXEC_PREFIX}/exec_${id}.json`;
}

function idFromPath(relativePath: string): string | null {
  const stripped = relativePath.startsWith(`${EXEC_PREFIX}/`)
    ? relativePath.slice(EXEC_PREFIX.length + 1)
    : relativePath;
  const m = stripped.match(/^exec_(.+)\.json$/);
  return m ? m[1] : null;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function itemFromContent(id: string, content: string): ExecutionRecordItem | null {
  if (isEncryptedFile(content)) {
    return {
      id,
      fileId: id,
      workflowId: "",
      startTime: "",
      status: "completed",
      stepCount: 0,
      isEncrypted: true,
    };
  }
  try {
    const record = JSON.parse(content) as ExecutionRecord;
    if (!record.id) return null;
    return {
      id: record.id,
      fileId: record.id,
      workflowId: record.workflowId,
      workflowName: record.workflowName,
      startTime: record.startTime,
      endTime: record.endTime,
      status: record.status,
      stepCount: record.steps?.length || 0,
    };
  } catch {
    return null;
  }
}

export async function saveExecutionRecordForTenant(
  ctx: ProjectAccessContext,
  record: ExecutionRecord,
  encryption?: EncryptionParams,
): Promise<string> {
  let content = JSON.stringify(record, null, 2);
  if (encryption) {
    content = await encryptFileContent(
      content,
      encryption.publicKey,
      encryption.encryptedPrivateKey,
      encryption.salt,
    );
  }
  await writeObject(ctx, pathFor(record.id), content, "application/json");

  // Strip variablesSnapshot from older records for the same workflow
  // (best-effort; storage savings only).
  void stripOldSnapshots(ctx, record.id, record.workflowId).catch((err) => {
    console.error("[workflow-history-tenant] strip snapshots failed:", err);
  });

  return record.id;
}

export async function listExecutionRecordsForTenant(
  ctx: ProjectAccessContext,
  workflowId?: string,
): Promise<ExecutionRecordItem[]> {
  const { objects } = await listObjects(ctx, { relativePrefix: EXEC_PREFIX });
  const items: ExecutionRecordItem[] = [];
  for (const obj of objects) {
    const id = idFromPath(obj.relativePath);
    if (!id) continue;
    try {
      const { bytes } = await readObject(ctx, obj.relativePath);
      const item = itemFromContent(id, decode(bytes));
      if (!item) continue;
      if (workflowId && item.workflowId !== workflowId) continue;
      items.push(item);
    } catch {
      // skip unreadable
    }
  }
  items.sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
  return items;
}

export async function loadExecutionRecordForTenant(
  ctx: ProjectAccessContext,
  id: string,
): Promise<ExecutionRecord | { encrypted: true; encryptedContent: string } | null> {
  try {
    const { bytes } = await readObject(ctx, pathFor(id));
    const content = decode(bytes);
    if (isEncryptedFile(content)) {
      return { encrypted: true, encryptedContent: content };
    }
    return JSON.parse(content) as ExecutionRecord;
  } catch (err) {
    if (err instanceof GcsObjectNotFoundError) return null;
    throw err;
  }
}

export async function deleteExecutionRecordForTenant(
  ctx: ProjectAccessContext,
  id: string,
): Promise<void> {
  try {
    await deleteObject(ctx, pathFor(id));
  } catch (err) {
    if (err instanceof GcsObjectNotFoundError) return;
    throw err;
  }
}

async function stripOldSnapshots(
  ctx: ProjectAccessContext,
  excludeId: string,
  workflowId: string,
): Promise<void> {
  const { objects } = await listObjects(ctx, { relativePrefix: EXEC_PREFIX });
  for (const obj of objects) {
    const id = idFromPath(obj.relativePath);
    if (!id || id === excludeId) continue;
    try {
      const { bytes } = await readObject(ctx, obj.relativePath);
      const text = decode(bytes);
      if (isEncryptedFile(text)) continue;
      const record = JSON.parse(text) as ExecutionRecord;
      if (record.workflowId !== workflowId) continue;
      const hasSnapshots = record.steps?.some((s) => s.variablesSnapshot);
      if (!hasSnapshots) continue;
      for (const step of record.steps) {
        delete step.variablesSnapshot;
      }
      await writeObject(
        ctx,
        obj.relativePath,
        JSON.stringify(record, null, 2),
        "application/json",
      );
    } catch {
      // skip
    }
  }
}
