import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { ImageCache, ImageWork } from "../server/image-cache.ts";
import { menuImageResource } from "../server/menu-images.ts";
import { loadMenuImage } from "../src/menu-image-loader.ts";
import type { ApiClient } from "../src/api.tsx";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample, shopSchema } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import type { CustomerFiles } from "../server/customer-files.ts";
import { createPreviewClient, sampleFixtures } from "../src/local-preview.ts";

const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const filesFor = (read: CustomerFiles["read"]): CustomerFiles => ({ read, reserve: async () => [], upload: async () => {}, rename: async () => {} });
const seed = async (store: Store, shopId: string, id: string, bytes = tiny) => store.put("menuImageUpload", id, { shopId, fileId: id, hash: id, mimeType: bytes === tiny ? "image/png" : "image/jpeg", size: bytes.length, complete: true });

test("image cache coalesces downloads, retries failures, expires and evicts by memory budget", async () => {
  let now = 0, loads = 0;
  const cache = new ImageCache<string>(8, 50, () => now);
  const load = () => cache.read("a", async () => { loads++; return "aaaa"; }, value => value.length);
  assert.deepEqual(await Promise.all([load(), load()]), ["aaaa", "aaaa"]); assert.equal(loads, 1);
  await cache.read("b", async () => "bbbb", value => value.length); await load();
  await cache.read("c", async () => "cccc", value => value.length);
  let bLoads = 0; await cache.read("b", async () => { bLoads++; return "bbbb"; }, value => value.length); assert.equal(bLoads, 1, "least recently used entry was evicted");
  now = 60; await load(); assert.equal(loads, 2);
  await assert.rejects(cache.read("failure", async () => { throw new Error("offline"); }, () => 1));
  assert.equal(await cache.read("failure", async () => "ok", () => 1), "ok");
  let hugeLoads = 0; for (let i = 0; i < 2; i++) await cache.read("huge", async () => { hugeLoads++; return "huge"; }, () => 100);
  assert.equal(hugeLoads, 2, "oversized entries are not retained");
});

test("image work bounds parallel Drive reads without serializing independent images", async () => {
  const work = new ImageWork(); let running = 0, peak = 0;
  await Promise.all(Array.from({ length: 12 }, () => work.run(async () => { running++; peak = Math.max(peak, running); await new Promise(resolve => setTimeout(resolve, 5)); running--; })));
  assert.equal(peak, 4);
});

test("browser image sharing is limited to pending requests in the same API context", async () => {
  let calls = 0;
  const api = (async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { mimeType: "image/png", data: "aA==" }; }) as ApiClient;
  await Promise.all([loadMenuImage(api, "/image/a"), loadMenuImage(api, "/image/a")]); assert.equal(calls, 1);
  await loadMenuImage(api, "/image/a"); assert.equal(calls, 2, "later mounts revalidate access");
  await Promise.all([loadMenuImage(api, "/image/a"), loadMenuImage(api, "/image/b")]); assert.equal(calls, 4);
  let fail = true; const other = (async () => { if (fail) throw new Error("offline"); return { mimeType: "image/png", data: "aA==" }; }) as ApiClient;
  await assert.rejects(loadMenuImage(other, "/image/a")); fail = false; await loadMenuImage(other, "/image/a");
});

test("cached image reads recheck ownership, archive status, metadata versions and lazy credentials", async t => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("image@example.com"), other = await store.createShop("other@example.com"), id = "a".repeat(64);
  await seed(store, shop.id, id); let reads = 0, tokens = 0;
  const files = filesFor(async () => { reads++; return tiny; }), token = async () => { tokens++; return "token"; };
  for (let i = 0; i < 2; i++) await (await menuImageResource(store, shop, id, files, token)).read();
  assert.equal(reads, 1); assert.equal(tokens, 1);
  await assert.rejects(menuImageResource(store, other, id, files, token));
  const receipt = (await store.get<any>("menuImageUpload", id))!;
  await store.put("menuImageUpload", id, { ...receipt, archived: true }); await assert.rejects(menuImageResource(store, shop, id, files, token));
  await store.put("menuImageUpload", id, { ...receipt, hash: "new-version" }); await (await menuImageResource(store, shop, id, files, token)).read(); assert.equal(reads, 2);
});

test("image GETs run outside the booking lock, reuse Drive bytes and revalidate access before 304", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  const first = "a".repeat(64), second = "b".repeat(64);
  shop.published = shopSchema.parse(structuredClone(sample)); shop.published.header.imageId = first; shop.published.menus[0].imageId = second; shop.publication = "public"; await store.saveShop(shop);
  await seed(store, shop.id, first); await seed(store, shop.id, second);
  await store.put("session", digest("owner"), { user: { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id }, expires: Date.now() + 600000 });
  let reads = 0, release!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { ready = resolve; });
  const server = createApp(store, undefined, undefined, filesFor(async () => { reads++; if (reads === 2) ready(); await gate; return tiny; }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { release(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const get = (path: string, user = "owner", etag?: string) => fetch(origin + path, { headers: { Cookie: `gemihub_session=${user}`, ...(etag ? { "If-None-Match": etag } : {}) } });
  const base = `/api/shops/${shop.id}/images/`, publicBase = `/api/public/${shop.slug}/images/`;
  const a = get(base + first), b = get(base + second), duplicate = get(publicBase + first, "anonymous");
  await Promise.race([started, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Drive reads are serialized")), 1000))]);
  const otherRead = await Promise.race([get(`/api/shops/${shop.id}/live-settings/basic`), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("image held the booking lock")), 1000))]); assert.equal(otherRead.status, 200); await otherRead.arrayBuffer();
  release(); const responses = await Promise.all([a, b, duplicate]); for (const response of responses) { assert.equal(response.status, 200); await response.arrayBuffer(); }
  assert.equal(reads, 2); const etag = responses[0].headers.get("etag")!; assert.ok(etag); assert.match(responses[0].headers.get("cache-control")!, /private.*must-revalidate/);
  assert.equal((await get(base + first, "owner", etag)).status, 304); assert.equal(reads, 2);
  assert.equal((await get(base + first, "anonymous", etag)).status, 403);
  delete shop.published.header.imageId; await store.saveShop(shop);
  assert.equal((await get(publicBase + first, "anonymous", etag)).status, 404, "unpublished images never return cached 304");
  shop.publication = "provisional"; await store.saveShop(shop);
  assert.equal((await get(publicBase + second, "anonymous", etag)).status, 401);
  const receipt = (await store.get<any>("menuImageUpload", first))!; await store.put("menuImageUpload", first, { ...receipt, archived: true });
  assert.equal((await get(base + first, "owner", etag)).status, 404);
});

test("display variants reduce transferred bytes, keep originals and share one Drive download", async t => {
  const store = new Store(":memory:"); t.after(() => store.close()); const shop = await store.createShop("resize@example.com"), id = "c".repeat(64);
  const bytes = await sharp(randomBytes(1800 * 1200 * 3), { raw: { width: 1800, height: 1200, channels: 3 } }).jpeg({ quality: 92 }).toBuffer(); await seed(store, shop.id, id, bytes);
  let reads = 0; const files = filesFor(async () => { reads++; return bytes; });
  const [thumbnail, display, original] = await Promise.all((["thumbnail", "display", "original"] as const).map(async view => (await menuImageResource(store, shop, id, files, "", view)).read()));
  assert.equal(reads, 1); assert.equal(original.data, bytes.toString("base64")); assert.equal(original.mimeType, "image/jpeg");
  for (const [image, max] of [[thumbnail, 480], [display, 1600]] as const) {
    assert.equal(image.mimeType, "image/webp"); const output = Buffer.from(image.data, "base64"), metadata = await sharp(output).metadata(); assert.ok(metadata.width! <= max); assert.ok(metadata.height! <= max); assert.ok(output.length < bytes.length);
  }
  assert.ok(Buffer.byteLength(thumbnail.data, "base64") < bytes.length / 4);
});

test("editor previews forward image variants after checking the referenced IDs", async () => {
  const config = shopSchema.parse(structuredClone(sample)), id = "d".repeat(64), calls: unknown[] = [];
  config.header.imageId = id;
  const client = createPreviewClient(config, sampleFixtures(config), "shop", async (...args) => { calls.push(args); return { mimeType: "image/png", data: tiny.toString("base64") }; });
  await client(`/api/public/local-preview/images/${id}?view=display`);
  await client(`/api/public/local-preview/images/${id}?view=thumbnail`);
  assert.deepEqual(calls, [[id, "display"], [id, "thumbnail"]]);
  await assert.rejects(client(`/api/public/local-preview/images/${"e".repeat(64)}?view=display`));
  assert.equal(calls.length, 2);
});
