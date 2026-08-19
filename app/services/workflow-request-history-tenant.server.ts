// Workflow AI-request history CRUD on tenant GCS.
// Stored at `gemihub/history/requests/req_{id}.json`. fileId === record.id.

import {
  GcsObjectNotFoundError,
  deleteObject,
  listObjects,
  readObject,
  writeObject,
} from "./gcs-storage.server";
import type { ProjectAccessContext } from "~/types/enterprise";
import type {
  WorkflowRequestRecord,
  WorkflowRequestRecordItem,
} from "~/engine/types";
import type { EncryptionParams } from "~/types/settings";
import { encryptFileContent, isEncryptedFile } from "./crypto.server";

const REQ_PREFIX = "gemihub/history/requests";

function pathFor(id: string): string {
  return `${REQ_PREFIX}/req_${id}.json`;
}

function idFromPath(relativePath: string): string | null {
  const stripped = relativePath.startsWith(`${REQ_PREFIX}/`)
    ? relativePath.slice(REQ_PREFIX.length + 1)
    : relativePath;
  const m = stripped.match(/^req_(.+)\.json$/);
  return m ? m[1] : null;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function itemFromContent(
  id: string,
  content: string,
): WorkflowRequestRecordItem | null {
  if (isEncryptedFile(content)) {
    return {
      id,
      fileId: id,
      workflowId: "",
      workflowName: "",
      createdAt: "",
      description: "",
      model: "",
      mode: "create",
      isEncrypted: true,
    };
  }
  try {
    const record = JSON.parse(content) as WorkflowRequestRecord;
    if (!record.id) return null;
    return {
      id: record.id,
      fileId: record.id,
      workflowId: record.workflowId,
      workflowName: record.workflowName,
      createdAt: record.createdAt,
      description: record.description,
      model: record.model,
      mode: record.mode,
    };
  } catch {
    return null;
  }
}

export async function saveRequestRecordForTenant(
  ctx: ProjectAccessContext,
  record: WorkflowRequestRecord,
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
  return record.id;
}

export async function listRequestRecordsForTenant(
  ctx: ProjectAccessContext,
  workflowId?: string,
): Promise<WorkflowRequestRecordItem[]> {
  const { objects } = await listObjects(ctx, { relativePrefix: REQ_PREFIX });
  const items: WorkflowRequestRecordItem[] = [];
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
      // skip
    }
  }
  items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return items;
}

export async function loadRequestRecordForTenant(
  ctx: ProjectAccessContext,
  id: string,
): Promise<
  WorkflowRequestRecord | { encrypted: true; encryptedContent: string } | null
> {
  try {
    const { bytes } = await readObject(ctx, pathFor(id));
    const content = decode(bytes);
    if (isEncryptedFile(content)) {
      return { encrypted: true, encryptedContent: content };
    }
    return JSON.parse(content) as WorkflowRequestRecord;
  } catch (err) {
    if (err instanceof GcsObjectNotFoundError) return null;
    throw err;
  }
}

export async function deleteRequestRecordForTenant(
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
