import type { Route } from "./+types/api.settings.hubwork-migrate";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { google } from "googleapis";

/**
 * Parse schema.md content into a map of sheet name → column list.
 *
 * Expected format:
 * ```
 * ## sheet_name
 * - column1
 * - column2
 * ```
 */
function parseSchema(markdown: string): Record<string, string[]> {
  const schema: Record<string, string[]> = {};
  let currentSheet: string | null = null;
  for (const line of markdown.split("\n")) {
    const sheetMatch = line.match(/^##\s+(.+)/);
    if (sheetMatch) {
      currentSheet = sheetMatch[1].trim();
      schema[currentSheet] = [];
      continue;
    }
    if (currentSheet) {
      const colMatch = line.match(/^[-*]\s+(.+)/);
      if (colMatch) {
        // Extract column name only (strip type/example after ":")
        const colName = colMatch[1].split(":")[0].trim();
        schema[currentSheet].push(colName);
      }
    }
  }
  return schema;
}

/**
 * POST /api/settings/hubwork-migrate
 * Applies a schema.md definition to the spreadsheet — creates missing sheets
 * and appends missing columns to existing sheets.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);
  const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  const spreadsheetId = settings?.hubwork?.spreadsheets?.[0]?.id;
  if (!spreadsheetId) {
    return Response.json({ error: "No spreadsheet configured" }, { status: 400 });
  }

  const body = await request.json();
  const schemaText = body.schema as string;
  if (!schemaText) {
    return Response.json({ error: "'schema' is required" }, { status: 400 });
  }

  const desired = parseSchema(schemaText);
  if (Object.keys(desired).length === 0) {
    return Response.json({ error: "No sheets found in schema" }, { status: 400 });
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: validTokens.accessToken });
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    // Get current spreadsheet state
    const ss = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    const existingSheets = new Set(
      (ss.data.sheets || []).map((s) => s.properties?.title || "").filter(Boolean)
    );

    // Fetch headers for existing sheets
    const existingHeaders: Record<string, string[]> = {};
    const sheetsToFetch = Object.keys(desired).filter((name) => existingSheets.has(name));
    if (sheetsToFetch.length > 0) {
      const ranges = sheetsToFetch.map((name) => `'${name.replace(/'/g, "''")}'!1:1`);
      const batchRes = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
      const valueRanges = batchRes.data.valueRanges || [];
      for (let i = 0; i < valueRanges.length && i < sheetsToFetch.length; i++) {
        existingHeaders[sheetsToFetch[i]] = ((valueRanges[i].values?.[0]) || []) as string[];
      }
    }

    const created: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];

    for (const [sheetName, desiredCols] of Object.entries(desired)) {
      if (!existingSheets.has(sheetName)) {
        // Create new sheet with headers
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }],
          },
        });
        if (desiredCols.length > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${sheetName.replace(/'/g, "''")}'!A1`,
            valueInputOption: "RAW",
            requestBody: { values: [desiredCols] },
          });
        }
        created.push(sheetName);
      } else {
        // Check for missing columns
        const current = existingHeaders[sheetName] || [];
        const currentSet = new Set(current);
        const missing = desiredCols.filter((col) => !currentSet.has(col));
        if (missing.length > 0) {
          const newHeaders = [...current, ...missing];
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${sheetName.replace(/'/g, "''")}'!A1`,
            valueInputOption: "RAW",
            requestBody: { values: [newHeaders] },
          });
          updated.push(sheetName);
        } else {
          unchanged.push(sheetName);
        }
      }
    }

    return Response.json({ created, updated, unchanged });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Migration failed: ${detail}` }, { status: 500 });
  }
}
