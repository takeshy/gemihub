/**
 * Audit logging service — Phase 6.
 *
 * Logs are written to Firestore `auditLogs/{orgId}/{logId}` for
 * compliance and forensic analysis. Each log entry is immutable
 * (created once, never updated).
 *
 * Retention: default 90 days. A Cloud Function or Dataflow job
 * can purge older docs based on `createdAt`.
 *
 * Actions:
 *   auth.login, auth.logout, auth.oidc_callback
 *   org.create, org.suspend, org.delete
 *   project.create
 *   member.add, member.remove, member.update_role
 *   storage.read, storage.write, storage.delete, storage.rename
 *   chat.stream, chat.compact
 *   workflow.execute_node
 *   settings.update
 */

import { FieldValue } from "@google-cloud/firestore";
import { existsSync, statSync } from "node:fs";
import { getFirestore } from "./firestore.server";

export const AUDIT_LOGS_COLLECTION = "auditLogs";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.oidc_callback"
  | "org.create"
  | "org.suspend"
  | "org.delete"
  | "project.create"
  | "project.delete"
  | "project.update-slug"
  | "member.add"
  | "member.remove"
  | "member.update_role"
  | "storage.read"
  | "storage.write"
  | "storage.delete"
  | "storage.rename"
  | "chat.stream"
  | "chat.compact"
  | "workflow.execute_node"
  | "settings.update"
  | "idp.update"
  | "invite.send"
  | "invite.accept"
  | "admin.super_action";

export interface AuditLogEntry {
  logId: string;
  orgId: string;
  projectId?: string;
  uid: string;
  email: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  /** Free-form metadata (sanitized — no PII beyond email/uid). */
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  statusCode?: number;
  errorMessage?: string;
  createdAt: number;
}

interface WriteInput {
  orgId: string;
  projectId?: string;
  uid: string;
  email: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  request?: Request;
  statusCode?: number;
  errorMessage?: string;
}

function getIp(request?: Request): string | undefined {
  if (!request) return undefined;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? undefined;
}

function getUserAgent(request?: Request): string | undefined {
  return request?.headers.get("user-agent") ?? undefined;
}

function hasUsableApplicationCredentials(): boolean {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) return true;
  try {
    return existsSync(credentialsPath) && statSync(credentialsPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Write an audit log entry. Fire-and-forget: failures are logged to
 * stderr but never thrown (audit logging must not break user-facing
 * operations).
 */
export async function writeAuditLog(input: WriteInput): Promise<void> {
  try {
    if (!hasUsableApplicationCredentials()) {
      console.warn("[audit-log] skipped: GOOGLE_APPLICATION_CREDENTIALS does not point to a readable file");
      return;
    }

    const fs = getFirestore();
    const doc = fs
      .collection(AUDIT_LOGS_COLLECTION)
      .doc(input.orgId)
      .collection("logs")
      .doc();

    const entry = stripUndefined({
      orgId: input.orgId,
      projectId: input.projectId,
      uid: input.uid,
      email: input.email,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: sanitizeMetadata(input.metadata),
      ip: getIp(input.request),
      userAgent: getUserAgent(input.request),
      statusCode: input.statusCode,
      errorMessage: input.errorMessage,
      createdAt: FieldValue.serverTimestamp(),
    });

    await doc.set(entry);
  } catch (err) {
    console.error("[audit-log] failed to write:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * List recent audit logs for an org. Ordered newest-first.
 * This is intended for the admin UI (paginated).
 */
export async function listAuditLogs(
  orgId: string,
  options: { limit?: number; before?: number } = {},
): Promise<AuditLogEntry[]> {
  const fs = getFirestore();
  let q = fs
    .collection(AUDIT_LOGS_COLLECTION)
    .doc(orgId)
    .collection("logs")
    .orderBy("createdAt", "desc");

  if (options.limit) q = q.limit(options.limit);
  if (options.before) q = q.where("createdAt", "<", new Date(options.before));

  const snap = await q.get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      logId: d.id,
      orgId: data.orgId,
      projectId: data.projectId,
      uid: data.uid,
      email: data.email,
      action: data.action,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      metadata: data.metadata,
      ip: data.ip,
      userAgent: data.userAgent,
      statusCode: data.statusCode,
      errorMessage: data.errorMessage,
      // Firestore timestamps come back as Timestamps; convert to epoch ms
      createdAt:
        data.createdAt?.toMillis?.() ??
        (typeof data.createdAt === "number" ? data.createdAt : Date.now()),
    } satisfies AuditLogEntry;
  });
}

/**
 * Convenience helper for routes that already have `tokens` and `ctx`.
 * Fire-and-forget — never throws.
 */
export function auditFromRoute(
  input: Omit<WriteInput, "uid" | "email"> & { uid?: string; email?: string },
): void {
  if (!input.uid || !input.email) return;
  void writeAuditLog(input as WriteInput).catch((err) => {
    console.error("[audit-log] failed to write:", err instanceof Error ? err.message : String(err));
  });
}

/** Remove sensitive fields from metadata before persisting. */
function sanitizeMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const cloned = { ...meta };
  const sensitiveKeys = ["password", "secret", "token", "apiKey", "clientSecret", "privateKey"];
  for (const key of sensitiveKeys) {
    if (key in cloned) {
      cloned[key] = "[REDACTED]";
    }
  }
  return cloned;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefined(item)) as T;
  }
  if (!value || typeof value !== "object" || value instanceof FieldValue) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = stripUndefined(item);
    }
  }
  return result as T;
}
