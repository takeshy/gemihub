import crypto from "node:crypto";
import { Timestamp } from "@google-cloud/firestore";
import type { sheets_v4 } from "googleapis";
import { getFirestore, HUBWORK_PENDING_REGISTRATIONS } from "./firestore.server";
import type { HubworkRegisterField } from "~/types/settings";

const PENDING_TTL_MS = 10 * 60 * 1000;

export interface PendingRegistrationData {
  accountId: string;
  type: string;
  email: string;
  fields: Record<string, string>;
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim().replace(/\u3000/g, "").replace(/\s+/g, "");
}

/**
 * Validate submitted fields against the schema. Returns either sanitized values
 * or the first error encountered (label-keyed for display).
 */
export function validateRegistrationFields(
  schema: HubworkRegisterField[],
  submitted: Record<string, unknown>,
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const values: Record<string, string> = {};

  for (const field of schema) {
    const raw = submitted[field.name];
    const value = raw == null ? "" : String(raw).trim();

    if (field.required && !value) {
      return { ok: false, error: `"${field.label}" is required` };
    }

    if (value) {
      // Security check first so CRLF is rejected regardless of maxLength.
      if (/[\r\n]/.test(value)) {
        return { ok: false, error: `"${field.label}" contains invalid characters` };
      }
      if (field.maxLength && value.length > field.maxLength) {
        return { ok: false, error: `"${field.label}" is too long` };
      }
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(value)) {
            return { ok: false, error: `"${field.label}" has invalid format` };
          }
        } catch {
          // Malformed pattern — skip silently rather than blocking the user.
        }
      }
      if (field.type === "select" && field.options && !field.options.includes(value)) {
        return { ok: false, error: `"${field.label}" has invalid value` };
      }
      if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { ok: false, error: `"${field.label}" is not a valid email` };
      }
    }

    values[field.name] = value;
  }

  return { ok: true, values };
}

export async function createPendingRegistration(
  data: PendingRegistrationData,
): Promise<string> {
  const db = getFirestore();
  const col = db.collection(HUBWORK_PENDING_REGISTRATIONS);
  const normalized = normalizeEmail(data.email);

  // Invalidate any pending rows for the same email+account.
  const existing = await col
    .where("email", "==", normalized)
    .where("accountId", "==", data.accountId)
    .where("used", "==", false)
    .get();
  const batch = db.batch();
  for (const doc of existing.docs) {
    batch.delete(doc.ref);
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  batch.set(col.doc(token), {
    accountId: data.accountId,
    type: data.type,
    email: normalized,
    fields: data.fields,
    expiresAt: Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
    used: false,
  });

  await batch.commit();
  return token;
}

/**
 * Verify a pending-registration token. Returns the stored data if valid,
 * null otherwise. Atomically marks the token as used via a transaction.
 */
export async function verifyPendingRegistration(
  token: string,
): Promise<PendingRegistrationData | null> {
  const db = getFirestore();
  const docRef = db.collection(HUBWORK_PENDING_REGISTRATIONS).doc(token);

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    if (!doc.exists) return null;
    const data = doc.data()!;
    if (data.used) return null;

    const expiresAt = data.expiresAt as Timestamp;
    if (expiresAt.toMillis() < Date.now()) {
      tx.delete(docRef);
      return null;
    }

    tx.update(docRef, { used: true });
    return {
      accountId: data.accountId as string,
      type: data.type as string,
      email: data.email as string,
      fields: (data.fields || {}) as Record<string, string>,
    };
  });
}

/**
 * Check whether an email already exists in the identity sheet.
 * Used by both registration (for duplicate policy) and as a general helper.
 */
export async function emailExistsInSheet(
  sheetsClient: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  emailColumn: string,
  email: string,
): Promise<boolean> {
  const res = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return false;
  const headers = rows[0] as string[];
  const idx = headers.indexOf(emailColumn);
  if (idx === -1) return false;
  const target = normalizeEmail(email);
  return rows.slice(1).some(
    (row) => normalizeEmail(((row as string[])[idx] || "")) === target,
  );
}

/**
 * Append a new row to the identity sheet using the collected registration fields.
 * The row is aligned to the sheet's header order; unknown headers get empty strings.
 */
export async function appendRegistrationRow(
  sheetsClient: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  emailColumn: string,
  email: string,
  fields: Record<string, string>,
): Promise<void> {
  const headerRes = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!1:1`,
  });
  const headers = (headerRes.data.values?.[0] || []) as string[];
  if (headers.length === 0) {
    throw new Error(`Sheet "${sheetName}" has no headers`);
  }

  const merged: Record<string, string> = { ...fields, [emailColumn]: email };
  const row = headers.map((h) => merged[h.trim()] ?? "");

  await sheetsClient.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}
