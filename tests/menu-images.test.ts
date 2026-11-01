import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { google } from "googleapis";
import { Store, type Shop } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample, shopSchema } from "../server/domain.ts";
import { memoryCustomerFiles } from "../server/customer-files.ts";
import { uploadMenuImage, readMenuImage } from "../server/menu-images.ts";
import { syncConfig, readConfig, encrypt } from "../server/google.ts";
import { driveSnapshot } from "../server/artifacts.ts";
import { postArtifacts } from "../server/post-renderer.tsx";
import { createPreviewClient, sampleFixtures } from "../src/local-preview.ts";

const image = { mimeType: "image/png" as const, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=" };
process.env.DEMO_MODE = "true";

test("Menu images are owner managed, stay private until saved, and never expose CRM or other-shop files", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
  const other = await store.createShop("other@example.com"); other.published = structuredClone(sample); await store.saveShop(other);
  const users = { owner: { email: shop.owner, role: "owner" }, staff: { email: "staff@example.com", role: "customer" }, customer: { email: "guest@example.com", role: "customer" }, other: { email: other.owner, role: "owner" } };
  for (const [id, user] of Object.entries(users)) await store.put("session", digest(id), { user: { ...user, name: id, shopId: shop.id }, expires: Date.now() + 600000 });
  await store.put("member", `${shop.id}:staff@example.com`, { email: users.staff.email, shopId: shop.id, accepted: true, status: "accepted" });
  const server = createApp(store); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  async function request(path: string, data?: unknown, user = "owner") {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `omai_session=${user}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  const base = `/api/shops/${shop.id}`;
  const upload = { ...image, requestId: randomUUID(), name: "コースの仕上がり.png" };
  for (const user of ["staff", "customer", "other", "anonymous"]) assert.equal((await request(`${base}/menu-images`, upload, user)).status, 403);
  assert.equal((await request(`${base}/menu-images`, { ...upload, mimeType: "image/svg+xml" })).status, 400);
  assert.equal((await request(`${base}/menu-images`, { ...upload, data: "aGVsbG8=" })).status, 400);
  const saved = await request(`${base}/menu-images`, upload); assert.equal(saved.status, 200);
  const id = saved.body.imageId;
  assert.equal((await request(`${base}/menu-images`, upload)).body.imageId, id);
  assert.equal((await request(`${base}/menu-images`, { ...upload, name: "changed.png" })).status, 409);
  assert.deepEqual((await request(`${base}/menu-images/${id}`)).body, image);
  assert.equal((await request(`${base}/menu-images/${id}`, undefined, "staff")).status, 403);
  const publicPath = `/api/public/${shop.slug}/menu-images/${id}`;
  assert.equal((await request(publicPath, undefined, "anonymous")).status, 404);
  async function menus(value: unknown, requestId = randomUUID()) {
    const previous = (await store.shop(shop.id))!.published!.menus;
    return request(`${base}/live-settings/menus`, { previous, value, requestId });
  }
  const config = structuredClone(sample); config.menus[0].imageId = id;
  assert.equal((await menus(config.menus)).status, 200);
  assert.deepEqual((await request(publicPath, undefined, "anonymous")).body, image);
  assert.equal((await store.shop(shop.id))!.published!.menus[0].imageId, id);
  assert.deepEqual((await store.shop(shop.id))!.published!.hours, sample.hours);
  const privateId = "b".repeat(64);
  await store.put("customerNoteUpload", privateId, { attachments: [{ id: "private-crm-file" }], createdAt: new Date().toISOString() });
  const forged = structuredClone(config.menus); forged[0].imageId = privateId;
  assert.notEqual((await menus(forged)).status, 200);
  assert.equal((await request(`/api/public/${shop.slug}/menu-images/${privateId}`, undefined, "anonymous")).status, 404);
  other.published!.menus[0].imageId = id; await store.saveShop(other);
  assert.equal((await request(`/api/public/${other.slug}/menu-images/${id}`, undefined, "anonymous")).status, 404);
  config.menus[0].active = false;
  assert.equal((await menus(config.menus)).status, 200);
  assert.equal((await request(publicPath, undefined, "anonymous")).status, 404);
  config.menus[0].active = true; delete config.menus[0].imageId;
  assert.equal((await menus(config.menus)).status, 200);
  assert.equal((await request(publicPath, undefined, "anonymous")).status, 404);
  assert.equal((await request(`${base}/menu-images/${id}`)).status, 200);
});

test("Interrupted menu image uploads reuse reserved IDs; active images survive offline export and preview", async () => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com");
  const files = memoryCustomerFiles(store); let reserves = 0; let interrupt = true;
  const gateway = { ...files, async reserve(count: number, token: string) { reserves++; return files.reserve(count, token); }, async upload(...args: Parameters<typeof files.upload>) { await files.upload(...args); if (interrupt) { interrupt = false; throw new Error("lost response"); } } };
  const input = { ...image, name: "menu.png", requestId: randomUUID() };
  await assert.rejects(() => uploadMenuImage(store, shop, input, gateway, ""), /lost response/);
  const { imageId } = await uploadMenuImage(store, shop, input, gateway, "");
  await uploadMenuImage(store, shop, input, gateway, ""); assert.equal(reserves, 1);
  assert.equal((await store.list("demoCustomerFile")).length, 1);
  const config = shopSchema.parse(sample); config.menus[0].imageId = imageId;
  const assets = { [imageId]: await readMenuImage(store, shop, imageId, gateway, ""), ["c".repeat(64)]: image };
  const snapshot = driveSnapshot(config, "<title></title><div id=\"root\"></div>", undefined, assets);
  const mock = JSON.parse(snapshot["web/mock.json"]);
  assert.deepEqual(Object.keys(mock.menuImages), [imageId]);
  assert.deepEqual(JSON.parse(postArtifacts(config, [], "<title></title><div id=\"root\"></div>", assets)["web/mock.json"]).menuImages, mock.menuImages);
  const preview = createPreviewClient(config, sampleFixtures(config), shop.id, async id => mock.menuImages[id]);
  assert.deepEqual(await preview(`/api/public/local-preview/menu-images/${imageId}`), image);
  await assert.rejects(preview(`/api/public/local-preview/menu-images/${"c".repeat(64)}`));
  config.menus[0].active = false;
  assert.deepEqual(JSON.parse(driveSnapshot(config, "<title></title><div id=\"root\"></div>", undefined, assets)["web/mock.json"]).menuImages, {});
});

test("Menu image references round-trip through the trailing Sheets column", async t => {
  t.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
  mock.method(fs, "readFile", async () => "<title></title><div id=\"root\"></div>"); syncBuiltinESMExports();
  const tables = new Map<string, unknown[][]>();
  mock.method(google, "sheets", (() => ({ spreadsheets: { values: {
    batchUpdate: async ({ requestBody }: any) => { for (const entry of requestBody.data) tables.set(entry.range.split("!")[0], entry.values); },
    batchClear: async () => {},
    batchGet: async ({ ranges }: any) => ({ data: { valueRanges: ranges.map((range: string) => ({ values: tables.get(range.split("!")[0]) })) } }),
  } } })) as any);
  mock.method(google, "drive", (() => ({ files: { create: async () => ({ data: { id: randomUUID() } }), update: async () => ({ data: {} }) } })) as any);
  const shop: Shop = { id: "shop", owner: "owner@example.com", slug: "shop", published: sample, draft: null, revision: 0, history: [], google: { folderId: "folder", sheetId: "sheet", specId: "spec", historyId: "history" } };
  const config = shopSchema.parse(sample); const id = "a".repeat(64); config.menus[0].imageId = id;
  await syncConfig(shop, config, encrypt("token"), () => {}, undefined, { [id]: image });
  assert.deepEqual(tables.get("menus")![0], ["id", "name", "duration", "price", "active", "imageId"]);
  assert.equal(tables.get("menus")![1][5], id);
  assert.equal((await readConfig(shop, encrypt("token"))).menus[0].imageId, id);
  delete config.menus[0].imageId;
  await syncConfig(shop, config, encrypt("token"));
  assert.equal((await readConfig(shop, encrypt("token"))).menus[0].imageId, undefined);
});
