import type { Route } from "./+types/api.settings.hubwork-sheets";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { google } from "googleapis";

/**
 * GET /api/settings/hubwork-sheets?spreadsheetId=...
 * Returns sheet tab names for a given spreadsheet.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  const url = new URL(request.url);
  const spreadsheetId = url.searchParams.get("spreadsheetId");
  if (!spreadsheetId) {
    return Response.json({ error: "spreadsheetId is required" }, { status: 400 });
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: validTokens.accessToken });
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });

    const sheetNames = (res.data.sheets || []).map(
      (s) => s.properties?.title || ""
    ).filter(Boolean);

    return Response.json({ sheets: sheetNames });
  } catch {
    return Response.json({ error: "Failed to fetch spreadsheet. Check the ID and permissions." }, { status: 400 });
  }
}
