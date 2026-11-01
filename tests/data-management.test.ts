import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { Store } from "../server/store.ts";
import { sample } from "../server/domain.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { encrypt } from "../server/google.ts";
import { listDataSheets, readDataTable, writeDataRow } from "../server/data-management.ts";
import { shopData } from "../server/shop-data.ts";

process.env.DEMO_MODE = "true";
test("Data management lists only extra sheets, enforces ownership, preserves cells, detects conflicts and retries fixed rows", async t => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com"); shop.published = sample; await store.saveShop(shop);
  const sheet = { shopId: shop.id, id: "42", title: "店販の記録", headers: ["商品", "個数", "確認", "計算式"], values: [["ヘアオイル", 2, false, "=B2*2"]] };
  await store.put("demoDataSheet", `${shop.id}:42`, sheet);
  await store.put("demoDataSheet", `${shop.id}:0`, { ...sheet, id: "0", title: "menus" });
  const other = await store.createShop("other@example.com");
  await store.put("demoDataSheet", `${other.id}:77`, { ...sheet, shopId: other.id, id: "77", title: "他店舗の記録" });
  for (const [id, email] of [["owner", shop.owner], ["staff", "staff@example.com"], ["customer", "guest@example.com"], ["other", other.owner]]) await store.put("session", digest(id), { user: { email, name: id, role: id === "owner" || id === "other" ? "owner" : "customer", shopId: shop.id }, expires: Date.now() + 600000 });
  await store.put("member", `${shop.id}:staff@example.com`, { shopId: shop.id, email: "staff@example.com", accepted: true });
  const server = createApp(store); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  async function request(path: string, data?: unknown, id = "owner") {
    const response = await fetch(`${origin}/api/shops/${shop.id}/data/sheets${path}`, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${id}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  const input = { headers: sheet.headers, previous: sheet.values[0], values: ["ヘアオイル", 3, true, "=B2*2"] };
  for (const id of ["staff", "customer", "other", "anonymous"]) {
    assert.equal((await request("", undefined, id)).status, 403);
    assert.equal((await request("/42", undefined, id)).status, 403);
    assert.equal((await request("/42/rows/2", input, id)).status, 403);
  }
  assert.deepEqual((await request("")).body, [{ id: "42", title: "店販の記録" }]);
  assert.equal((await request("/0")).status, 404);
  assert.equal((await request("/0/rows/2", input)).status, 404);
  assert.equal((await request("/77")).status, 404);
  assert.equal((await request("/42/rows/1", input)).status, 400);
  assert.equal((await request("/42/rows/2", { ...input, headers: [...sheet.headers].reverse() })).status, 409);
  assert.equal((await request("/42/rows/2", { ...input, values: ["", "", "", ""] })).status, 400);
  assert.equal((await request("/42/rows/2", { ...input, values: ["ヘアオイル", 3, true, "changed formula"] })).status, 400);
  assert.equal((await request("/42/rows/2", input)).status, 200);
  assert.equal((await request("/42/rows/2", input)).status, 200);
  assert.deepEqual((await request("/42")).body.rows[0].values, input.values);
  assert.equal((await request("/42/rows/2", { ...input, values: ["ヘアオイル", 9, true, "=B2*2"] })).status, 409);
  const added = { headers: sheet.headers, previous: ["", "", "", ""], values: ["シャンプー", 1, false, ""] };
  assert.equal((await request("/42/rows/3", added)).status, 200);
  assert.equal((await request("/42/rows/3", added)).status, 200);
  assert.equal((await request("/42")).body.rows.length, 2);
  assert.equal((await request("/42")).body.nextRow, 4);
  assert.deepEqual((await request("/42")).body.headers, sheet.headers);
  assert.equal((await store.records<any>("demoDataSheet", shop)).find(s => s.id === "0").values[0][1], 2);
  assert.equal(new Set(shopData.map(data => data.sheet)).size, 12);
});

test("Extra Sheets use quoted names and RAW updates for changed cells while leaving headers and formulas intact", async t => {
  t.after(() => mock.restoreAll());
  const writes: any[] = [];
  const cells: (string | number | boolean)[] = ["商品", 2, false, "=B2*2"];
  mock.method(google, "sheets", (() => ({ spreadsheets: {
    get: async () => ({ data: { sheets: [{ properties: { sheetId: 0, title: "menus", sheetType: "GRID" } }, { properties: { sheetId: 42, title: "Owner's data", sheetType: "GRID" } }] } }),
    values: {
      get: async ({ range, valueRenderOption }: any) => { assert.equal(valueRenderOption, "FORMULA"); assert.ok(range.startsWith("'Owner''s data'!")); if (!range.endsWith("!1:1")) assert.equal(range, "'Owner''s data'!A2:D"); return { data: { values: range.endsWith("!1:1") ? [["商品", "数", "確認", "計算"]] : [cells] } }; },
      batchUpdate: async (input: any) => { writes.push(input); for (const change of input.requestBody.data) { const col = change.range.match(/!([A-D])2$/)![1].charCodeAt(0) - 65; cells[col] = change.values[0][0]; } },
    },
  } })) as any);
  const store = { memory: false } as Store;
  const shop = { id: "shop", google: { sheetId: "sheet" } } as any;
  const token = encrypt("token");
  assert.deepEqual(await listDataSheets(store, shop, token), [{ id: "42", title: "Owner's data" }]);
  const table = await readDataTable(store, shop, "42", token);
  await writeDataRow(store, shop, "42", 2, { headers: table.headers, previous: table.rows[0].values, values: ["商品", 4, true, "=B2*2"] }, token);
  assert.equal(writes[0].requestBody.valueInputOption, "RAW");
  assert.deepEqual(writes[0].requestBody.data.map((change: any) => change.range), ["'Owner''s data'!B2", "'Owner''s data'!C2"]);
  assert.deepEqual(cells, ["商品", 4, true, "=B2*2"]);
  await assert.rejects(() => readDataTable(store, shop, "0", token), /追加データ/);
});

test("Extra data rejects invalid headers, out-of-range rows and formulas supplied as new values", async t => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("owner@example.com");
  const sheet = { id: "42", shopId: shop.id, title: "追加データ", headers: ["名前", "数"], values: [["記録", 2]] as (string | number | boolean)[][] };
  async function put(headers: string[], values = sheet.values) { await store.put("demoDataSheet", `${shop.id}:42`, { ...sheet, headers, values }); }
  for (const headers of [[], [""], ["名前", "名前"], Array.from({ length: 101 }, (_, i) => String(i))]) {
    await put(headers); await assert.rejects(() => readDataTable(store, shop, "42", ""), /列名/);
  }
  await put(sheet.headers, [...Array.from({ length: 1000 }, () => []), ["末尾"]]);
  await assert.rejects(() => readDataTable(store, shop, "42", ""), /1000行/);
  await put(sheet.headers);
  const input = { headers: sheet.headers, previous: sheet.values[0], values: ["=IMPORTXML(\"https://example.com\",\"//body\")", 2] };
  await assert.rejects(() => writeDataRow(store, shop, "42", 2, input, ""), /数式/);
  await assert.rejects(() => writeDataRow(store, shop, "42", 4, { ...input, values: ["記録", 3] }, ""), /保存先の行/);
  assert.deepEqual((await readDataTable(store, shop, "42", "")).rows[0].values, sheet.values[0]);
});
