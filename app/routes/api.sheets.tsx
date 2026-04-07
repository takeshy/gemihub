import type { Route } from "./+types/api.sheets";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { google } from "googleapis";

/**
 * POST /api/sheets — Google Sheets operations for plugins.
 * Body: { action: "create"|"write"|"batchWrite", ...params }
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  const body = await request.json();
  const sheetsAction = body.action as string;

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: validTokens.accessToken });
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  try {
    switch (sheetsAction) {
      case "create": {
        const title = body.title as string;
        if (!title) return Response.json({ error: "'title' is required" }, { status: 400 });

        const sheetNames = (body.sheets as string[] | undefined) || [];

        const requestBody: Record<string, unknown> = {
          properties: { title },
        };
        if (sheetNames.length > 0) {
          requestBody.sheets = sheetNames.map((name, index) => ({
            properties: { title: name, index },
          }));
        }

        const res = await sheets.spreadsheets.create({ requestBody });
        return Response.json({
          spreadsheetId: res.data.spreadsheetId,
          url: res.data.spreadsheetUrl,
        });
      }

      case "write": {
        const spreadsheetId = body.spreadsheetId as string;
        const range = body.range as string;
        const values = body.values as (string | number)[][];

        if (!spreadsheetId) return Response.json({ error: "'spreadsheetId' is required" }, { status: 400 });
        if (!range) return Response.json({ error: "'range' is required" }, { status: 400 });
        if (!values) return Response.json({ error: "'values' is required" }, { status: 400 });

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: "RAW",
          requestBody: { values },
        });

        return Response.json({ success: true });
      }

      case "batchWrite": {
        const spreadsheetId = body.spreadsheetId as string;
        const data = body.data as Array<{ range: string; values: (string | number)[][] }>;

        if (!spreadsheetId) return Response.json({ error: "'spreadsheetId' is required" }, { status: 400 });
        if (!data) return Response.json({ error: "'data' is required" }, { status: 400 });

        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "RAW",
            data: data.map((d) => ({ range: d.range, values: d.values })),
          },
        });

        return Response.json({ success: true });
      }

      default:
        return Response.json({ error: `Unknown action: ${sheetsAction}` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sheets operation failed";
    const status = (e as { code?: number })?.code === 403 ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
}
