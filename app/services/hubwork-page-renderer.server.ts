import type { HubworkDataSource } from "~/types/settings";
import { google } from "googleapis";

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
      spreadsheetId,
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
