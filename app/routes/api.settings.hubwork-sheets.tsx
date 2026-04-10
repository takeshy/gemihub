import type { Route } from "./+types/api.settings.hubwork-sheets";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { google } from "googleapis";

/**
 * GET /api/settings/hubwork-sheets?spreadsheetId=...
 * Returns sheet tab names and column headers (first row) for a given spreadsheet.
 * Pass spreadsheetId=__default__ to use the first configured spreadsheet.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  const url = new URL(request.url);
  let spreadsheetId = url.searchParams.get("spreadsheetId");

  // Resolve __default__ to first configured spreadsheet
  if (spreadsheetId === "__default__") {
    const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
    spreadsheetId = settings?.hubwork?.spreadsheets?.[0]?.id || null;
  }

  if (!spreadsheetId) {
    return Response.json({ error: "spreadsheetId is required" }, { status: 400 });
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: validTokens.accessToken });
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title,sheets.properties.title",
    });

    const title = res.data.properties?.title || "";

    const sheetNames = (res.data.sheets || []).map(
      (s) => s.properties?.title || ""
    ).filter(Boolean);

    // Fetch first row (column headers) for each sheet
    const headers: Record<string, string[]> = {};
    if (sheetNames.length > 0) {
      const ranges = sheetNames.map((name) => `'${name.replace(/'/g, "''")}'!1:1`);
      const batchRes = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      });
      const valueRanges = batchRes.data.valueRanges || [];
      for (let i = 0; i < valueRanges.length && i < sheetNames.length; i++) {
        headers[sheetNames[i]] = ((valueRanges[i].values?.[0]) || []) as string[];
      }
    }

    return Response.json({ title, sheets: sheetNames, headers });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Failed to fetch spreadsheet: ${detail}` }, { status: 400 });
  }
}
