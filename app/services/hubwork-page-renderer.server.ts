import type { HubworkAccountIdentity, HubworkDataSource } from "~/types/settings";
import { google } from "googleapis";

// Same normalization as hubwork-magic-link.server.ts / auth.login route so a
// mid-width space or trailing whitespace in a sheet row still matches the
// email the user authenticated with.
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim().replace(/\u3000/g, "").replace(/\s+/g, "");
}

// Reserved `auth.*` variables populated unconditionally by the router.
// Identity-sheet columns with these names are skipped when exposing the
// row so a stray `type` / `email` column can't shadow the canonical vars.
const RESERVED_AUTH_KEYS = new Set(["type", "email"]);

/**
 * Pure row-matching half of {@link buildAuthProfile}. Given raw values from
 * Google Sheets (`rows[0]` headers, rest data), locate the row whose
 * `emailColumn` cell matches `email` (after normalization) and return the
 * other columns as a map. Exported for testing — the production caller
 * always routes through `buildAuthProfile` which adds the Sheets fetch.
 */
export function extractAuthProfileFromRows(
  rows: string[][],
  emailColumn: string,
  email: string,
): Record<string, string> {
  if (rows.length < 2) return {};
  const headers = rows[0];
  const emailIdx = headers.indexOf(emailColumn);
  if (emailIdx === -1) return {};

  const normalizedEmail = normalizeEmail(email);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalizeEmail(row?.[emailIdx] || "") !== normalizedEmail) continue;
    const profile: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      if (j === emailIdx) continue;
      const col = headers[j];
      if (!col) continue;
      if (RESERVED_AUTH_KEYS.has(col)) continue;
      profile[col] = row?.[j] || "";
    }
    return profile;
  }
  return {};
}

/**
 * Read the authenticated user's row from the identity sheet and return the
 * non-email columns as a flat map. The router turns each entry into an
 * `auth.<column>` workflow variable, so a typical accounts sheet with
 * `email`, `name`, `created_at`, `logined_at` yields `auth.name`,
 * `auth.created_at`, `auth.logined_at`.
 *
 * Returns `{}` on any failure (sheet missing, row missing, API error) so
 * the caller can unconditionally continue without a fallback branch.
 */
export async function buildAuthProfile(
  accessToken: string,
  defaultSpreadsheetId: string,
  identity: HubworkAccountIdentity,
  email: string,
): Promise<Record<string, string>> {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const sheetsClient = google.sheets({ version: "v4", auth: oauth2Client });
    const spreadsheetId = identity.spreadsheetId || defaultSpreadsheetId;
    if (!spreadsheetId) return {};

    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `'${identity.sheet.replace(/'/g, "''")}'`,
    });
    return extractAuthProfileFromRows(
      (res.data.values || []) as string[][],
      identity.emailColumn,
      email,
    );
  } catch {
    return {};
  }
}

/**
 * Build field-filtered currentUser data from Sheets.
 *
 * Each key in `dataConfig` maps to a sheet with matchBy, fields, limit, sort.
 * Returns an object like: { profile: { email, name, ... }, orders: [...] }
 */
export async function buildCurrentUser(
  accessToken: string,
  spreadsheetId: string,
  contactEmail: string,
  dataConfig?: Record<string, HubworkDataSource>,
): Promise<Record<string, unknown>> {
  if (!dataConfig || Object.keys(dataConfig).length === 0) {
    return {};
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const sheetsClient = google.sheets({ version: "v4", auth: oauth2Client });
  // Must match normalizeEmail() in hubwork-magic-link.server.ts and auth.login route
  const normalizedEmail = contactEmail.toLowerCase().trim().replace(/\u3000/g, "").replace(/\s+/g, "");

  const result: Record<string, unknown> = {};

  for (const [key, source] of Object.entries(dataConfig)) {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: source.spreadsheetId || spreadsheetId,
      range: `'${source.sheet.replace(/'/g, "''")}'`,
    });
    const rows = res.data.values || [];
    if (rows.length < 2) {
      result[key] = source.shape === "object" ? null : [];
      continue;
    }

    const headers = rows[0] as string[];
    const matchIdx = headers.indexOf(source.matchBy);
    if (matchIdx === -1) {
      result[key] = source.shape === "object" ? null : [];
      continue;
    }

    let matchingRows: Record<string, string>[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as string[];
      if ((row[matchIdx] || "").toLowerCase().trim().replace(/\u3000/g, "").replace(/\s+/g, "") === normalizedEmail) {
        const obj: Record<string, string> = {};
        for (const field of source.fields) {
          const colIdx = headers.indexOf(field);
          if (colIdx !== -1) {
            obj[field] = row[colIdx] || "";
          }
        }
        matchingRows.push(obj);
      }
    }

    // Sort if specified (prefix '-' for descending)
    if (source.sort) {
      const desc = source.sort.startsWith("-");
      const sortField = desc ? source.sort.slice(1) : source.sort;
      matchingRows.sort((a, b) => {
        const cmp = (a[sortField] || "").localeCompare(b[sortField] || "");
        return desc ? -cmp : cmp;
      });
    }

    // Limit
    if (source.limit && matchingRows.length > source.limit) {
      matchingRows = matchingRows.slice(0, source.limit);
    }

    if (source.shape === "object") {
      result[key] = matchingRows[0] || null;
    } else {
      result[key] = matchingRows;
    }
  }

  return result;
}
