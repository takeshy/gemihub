import { tr } from "../shared/i18n.ts";
import { z } from "zod";
import { clients } from "./google.ts";
import { shopData } from "./shop-data.ts";
import type { Shop, Store } from "./store.ts";

export type DataCell = string | number | boolean;
export type DataSheet = { id: string; title: string };
export type DataTable = DataSheet & { headers: string[]; rows: { row: number; values: DataCell[] }[]; nextRow: number };
type DemoSheet = DataSheet & { shopId: string; headers: string[]; values: DataCell[][] };
const standard = new Set<string>(shopData.map(data => data.sheet));
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const cell = z.union([z.string().max(50000), z.number().finite(), z.boolean()]);
export const dataRowSchema = z.object({ headers: z.array(z.string()).min(1).max(100), previous: z.array(cell).max(100), values: z.array(cell).max(100) });

export async function listDataSheets(store: Store, shop: Shop, token: string): Promise<DataSheet[]> {
  if (store.memory) return (await store.records<DemoSheet>("demoDataSheet", shop)).filter(sheet => !standard.has(sheet.title)).map(({ id, title }) => ({ id, title }));
  if (!shop.google) return [];
  const { sheets } = clients(token);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: shop.google.sheetId, fields: "sheets.properties(sheetId,title,sheetType)" });
  return (metadata.data.sheets || []).flatMap(sheet => {
    const p = sheet.properties;
    return p?.title && p.sheetId != null && (!p.sheetType || p.sheetType === "GRID") && !standard.has(p.title) ? [{ id: String(p.sheetId), title: p.title }] : [];
  });
}
const quote = (title: string) => `'${title.replace(/'/g, "''")}'`;
const column = (index: number) => { let name = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
const padded = (values: DataCell[], count: number) => Array.from({ length: count }, (_, index) => values[index] ?? "");
export async function readDataTable(store: Store, shop: Shop, id: string, token: string): Promise<DataTable> {
  const sheet = (await listDataSheets(store, shop, token)).find(sheet => sheet.id === id) || fail(404, tr("追加データのシートがありません"));
  let headers: string[];
  let values: DataCell[][];
  if (store.memory) {
    const demo = (await store.records<DemoSheet>("demoDataSheet", shop)).find(sheet => sheet.id === id)!;
    headers = demo.headers; values = demo.values;
  } else {
    const { sheets } = clients(token);
    const header = await sheets.spreadsheets.values.get({ spreadsheetId: shop.google!.sheetId, range: `${quote(sheet.title)}!1:1`, valueRenderOption: "FORMULA" });
    headers = header.data.values?.[0] || [];
    if (!headers.length || headers.length > 100 || headers.some(name => typeof name !== "string" || !name.trim()) || new Set(headers).size !== headers.length) fail(409, tr("1行目に重複のない列名を設定してください（100列まで）"));
    const rows = await sheets.spreadsheets.values.get({ spreadsheetId: shop.google!.sheetId, range: `${quote(sheet.title)}!A2:${column(headers.length - 1)}`, valueRenderOption: "FORMULA" });
    values = rows.data.values || [];
  }
  if (!headers.length || headers.length > 100 || headers.some(name => typeof name !== "string" || !name.trim()) || new Set(headers).size !== headers.length) fail(409, tr("1行目に重複のない列名を設定してください（100列まで）"));
  if (values.length > 1000) fail(409, tr("1000行を超えるデータはスプレッドシートで管理してください"));
  return { ...sheet, headers, rows: values.map((row, index) => ({ row: index + 2, values: padded(row, headers.length) })).filter(row => row.values.some(value => value !== "")), nextRow: values.length + 2 };
}
export async function writeDataRow(store: Store, shop: Shop, id: string, row: number, raw: unknown, token: string) {
  const input = dataRowSchema.parse(raw);
  const table = await readDataTable(store, shop, id, token);
  if (JSON.stringify(input.headers) !== JSON.stringify(table.headers) || input.values.length !== table.headers.length || input.previous.length !== table.headers.length) fail(409, tr("列が変更されています。最新の内容を読み直してください"));
  if (!Number.isInteger(row) || row < 2 || row > Math.min(table.nextRow, 1001)) fail(400, tr("保存先の行を確認してください"));
  if (input.values.every(value => value === "")) fail(400, tr("いずれかの項目を入力してください。行全体の削除はできません"));
  const current = table.rows.find(item => item.row === row)?.values || padded([], table.headers.length);
  // Fixed row + original values make a lost-response retry safe without appending twice.
  if (JSON.stringify(current) === JSON.stringify(input.values)) return;
  if (current.some((value, index) => value !== input.previous[index] && value !== input.values[index])) fail(409, tr("この行が更新されています。最新の内容を読み直してください。編集内容は画面に残っています"));
  const changes = input.values.flatMap((value, index) => {
    if (value === current[index]) return [];
    if (typeof current[index] === "string" && String(current[index]).startsWith("=") || typeof value === "string" && value.startsWith("=")) fail(400, tr("数式のセルはスプレッドシートで設定してください"));
    return [{ index, value }];
  });
  if (store.memory) {
    const demo = (await store.records<DemoSheet>("demoDataSheet", shop)).find(sheet => sheet.id === id)!;
    while (demo.values.length < row - 1) demo.values.push([]);
    demo.values[row - 2] = input.values;
    await store.put("demoDataSheet", `${shop.id}:${id}`, demo);
    return;
  }
  const { sheets } = clients(token);
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: shop.google!.sheetId, requestBody: { valueInputOption: "RAW", data: changes.map(change => ({ range: `${quote(table.title)}!${column(change.index)}${row}`, values: [[change.value]] })) } });
}
