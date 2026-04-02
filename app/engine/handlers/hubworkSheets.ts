import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";

function requireHubworkSheets(serviceContext: ServiceContext) {
  if (!serviceContext.hubworkSheetsClient || !serviceContext.hubworkSpreadsheetId) {
    throw new Error("Hubwork Sheets is not configured. Enable Hubwork and connect a spreadsheet.");
  }
  return {
    client: serviceContext.hubworkSheetsClient,
    spreadsheetId: serviceContext.hubworkSpreadsheetId,
  };
}

async function getSheetData(
  serviceContext: ServiceContext,
  sheetName: string
): Promise<{ headers: string[]; rows: string[][] }> {
  const { client, spreadsheetId } = requireHubworkSheets(serviceContext);
  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'`,
  });
  const allRows = res.data.values || [];
  if (allRows.length === 0) return { headers: [], rows: [] };
  return { headers: allRows[0] as string[], rows: allRows.slice(1) as string[][] };
}

function parseFilter(
  filterStr: string,
  context: ExecutionContext
): Record<string, string> {
  const resolved = replaceVariables(filterStr, context);
  try {
    return JSON.parse(resolved);
  } catch {
    const match = resolved.match(/^(\w+)\s*==\s*(.+)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return { [match[1]]: val };
    }
    throw new Error(`Invalid filter format: ${resolved}`);
  }
}

function matchesFilter(
  row: Record<string, string>,
  filter: Record<string, string>,
): boolean {
  const result = Object.entries(filter).every(([col, val]) => {
    const rowVal = row[col];
    return rowVal === val;
  });
  return result;
}

function rowsToObjects(headers: string[], rows: string[][]): Record<string, string>[] {
  const trimmedHeaders = headers.map((h) => h.trim());
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < trimmedHeaders.length; i++) {
      obj[trimmedHeaders[i]] = (row[i] || "").trim();
    }
    return obj;
  });
}

export async function handleSheetReadNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const sheetName = replaceVariables(node.properties["sheet"] || "", context);
  const saveTo = node.properties["saveTo"];
  const limitStr = node.properties["limit"];
  const filterStr = node.properties["filter"];

  if (!sheetName) throw new Error("sheet-read: 'sheet' property is required");
  if (!saveTo) throw new Error("sheet-read: 'saveTo' property is required");

  const { headers, rows } = await getSheetData(serviceContext, sheetName);
  let objects = rowsToObjects(headers, rows);

  if (filterStr) {
    const filter = parseFilter(filterStr, context);
    objects = objects.filter((row) => matchesFilter(row, filter));
  }

  if (limitStr) {
    const limit = parseInt(replaceVariables(limitStr, context), 10);
    if (!isNaN(limit) && limit > 0) objects = objects.slice(0, limit);
  }

  context.variables.set(saveTo, JSON.stringify(objects));
}

export async function handleSheetWriteNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const { client, spreadsheetId } = requireHubworkSheets(serviceContext);
  const sheetName = replaceVariables(node.properties["sheet"] || "", context);
  const dataStr = replaceVariables(node.properties["data"] || "", context);

  if (!sheetName) throw new Error("sheet-write: 'sheet' property is required");
  if (!dataStr) throw new Error("sheet-write: 'data' property is required");

  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!1:1`,
  });
  const headers = (res.data.values?.[0] || []) as string[];
  if (headers.length === 0) throw new Error(`Sheet "${sheetName}" has no headers`);

  let dataObj: Record<string, string>[];
  try {
    const parsed = JSON.parse(dataStr);
    dataObj = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error("sheet-write: 'data' must be valid JSON");
  }

  const values = dataObj.map((row) => headers.map((h) => row[h] || ""));

  await client.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

export async function handleSheetUpdateNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const { client, spreadsheetId } = requireHubworkSheets(serviceContext);
  const sheetName = replaceVariables(node.properties["sheet"] || "", context);
  const filterStr = node.properties["filter"];
  const dataStr = replaceVariables(node.properties["data"] || "", context);

  if (!sheetName) throw new Error("sheet-update: 'sheet' property is required");
  if (!filterStr) throw new Error("sheet-update: 'filter' property is required");
  if (!dataStr) throw new Error("sheet-update: 'data' property is required");

  const filter = parseFilter(filterStr, context);
  let updates: Record<string, string>;
  try {
    updates = JSON.parse(dataStr);
  } catch {
    throw new Error("sheet-update: 'data' must be valid JSON");
  }

  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'`,
  });
  const allRows = res.data.values || [];
  if (allRows.length < 2) return;

  const headers = allRows[0] as string[];
  let updatedCount = 0;

  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i] as string[];
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = row[j] || "";

    if (matchesFilter(obj, filter)) {
      for (const [col, val] of Object.entries(updates)) {
        const colIdx = headers.indexOf(col);
        if (colIdx !== -1) {
          while (row.length <= colIdx) row.push("");
          row[colIdx] = val;
        }
      }
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName.replace(/'/g, "''")}'`,
      valueInputOption: "RAW",
      requestBody: { values: allRows },
    });
  }

  const saveTo = node.properties["saveTo"];
  if (saveTo) context.variables.set(saveTo, updatedCount);
}

export async function handleSheetDeleteNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const { client, spreadsheetId } = requireHubworkSheets(serviceContext);
  const sheetName = replaceVariables(node.properties["sheet"] || "", context);
  const filterStr = node.properties["filter"];

  if (!sheetName) throw new Error("sheet-delete: 'sheet' property is required");
  if (!filterStr) throw new Error("sheet-delete: 'filter' property is required");

  const filter = parseFilter(filterStr, context);

  const escapedSheet = sheetName.replace(/'/g, "''");

  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${escapedSheet}'`,
  });
  const allRows = res.data.values || [];
  if (allRows.length < 2) return;

  const headers = allRows[0] as string[];
  // Collect 0-based row indices to delete (data rows start at index 1)
  const deleteIndices: number[] = [];

  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i] as string[];
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = row[j] || "";

    if (matchesFilter(obj, filter)) {
      deleteIndices.push(i);
    }
  }

  if (deleteIndices.length > 0) {
    // Resolve sheetId for the batchUpdate API
    const spreadsheet = await client.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const sheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === sheetName
    );
    if (!sheet?.properties) {
      throw new Error(`sheet-delete: sheet "${sheetName}" not found in spreadsheet`);
    }
    const sheetId = sheet.properties.sheetId ?? 0;

    // Delete rows bottom-up to preserve indices
    const requests = [...deleteIndices]
      .reverse()
      .map((rowIndex) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS" as const,
            startIndex: rowIndex,
            endIndex: rowIndex + 1,
          },
        },
      }));

    await client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  const saveTo = node.properties["saveTo"];
  if (saveTo) context.variables.set(saveTo, deleteIndices.length);
}
