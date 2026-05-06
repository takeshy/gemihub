import type { Route } from "./+types/api.sheets";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { google } from "googleapis";

function getSheetsClient(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

function quoteSheetName(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, sessionTokens);
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const spreadsheetId = url.searchParams.get("spreadsheetId");
  const sheetName = url.searchParams.get("sheetName");
  const range = url.searchParams.get("range");

  if (action !== "read") {
    return jsonWithCookie({ error: "Unknown action" }, { status: 400 });
  }
  if (!spreadsheetId) {
    return jsonWithCookie({ error: "'spreadsheetId' is required" }, { status: 400 });
  }

  const sheets = getSheetsClient(validTokens.accessToken);
  try {
    const metaRes = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties(title),sheets(properties(title,index,gridProperties(rowCount,columnCount)))",
    });
    const sheetMetas = metaRes.data.sheets ?? [];
    const sheetsList = sheetMetas
      .map((sheet) => ({
        title: sheet.properties?.title ?? "",
        index: sheet.properties?.index ?? 0,
        rowCount: sheet.properties?.gridProperties?.rowCount ?? 100,
        columnCount: sheet.properties?.gridProperties?.columnCount ?? 26,
      }))
      .filter((sheet) => sheet.title);
    const selectedSheet = sheetsList.find((sheet) => sheet.title === sheetName) ?? sheetsList[0];
    if (!selectedSheet) {
      return jsonWithCookie({ error: "Spreadsheet has no sheets" }, { status: 400 });
    }

    const readRange = range || `${quoteSheetName(selectedSheet.title)}!A1:Z100`;
    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: readRange,
      valueRenderOption: "FORMULA",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    return jsonWithCookie({
      title: metaRes.data.properties?.title ?? "",
      sheets: sheetsList,
      selectedSheet: selectedSheet.title,
      range: readRange,
      values: valuesRes.data.values ?? [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sheets read failed";
    const status = (e as { code?: number })?.code === 403 ? 403 : 500;
    return jsonWithCookie({ error: message }, { status });
  }
}

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

  const sheets = getSheetsClient(validTokens.accessToken);

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
        const valueInputOption = (body.valueInputOption as "RAW" | "USER_ENTERED" | undefined) || "RAW";

        if (!spreadsheetId) return Response.json({ error: "'spreadsheetId' is required" }, { status: 400 });
        if (!range) return Response.json({ error: "'range' is required" }, { status: 400 });
        if (!values) return Response.json({ error: "'values' is required" }, { status: 400 });

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption,
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

      case "updateValues": {
        const spreadsheetId = body.spreadsheetId as string;
        const range = body.range as string;
        const values = body.values as (string | number | boolean | null)[][];

        if (!spreadsheetId) return Response.json({ error: "'spreadsheetId' is required" }, { status: 400 });
        if (!range) return Response.json({ error: "'range' is required" }, { status: 400 });
        if (!values) return Response.json({ error: "'values' is required" }, { status: 400 });

        const res = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        });

        return Response.json({ success: true, updatedCells: res.data.updatedCells ?? 0 });
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
