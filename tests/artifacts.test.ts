import { test } from "node:test";
import assert from "node:assert/strict";
import { sample } from "../server/domain.ts";
import { artifacts, renderShop } from "../server/artifacts.ts";
import { Store } from "../server/store.ts";
import { encrypt, decrypt } from "../server/google.ts";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { driveMock } from "../server/drive-mock.ts";
import { drivePreviewData } from "../src/drive-preview.ts";
test("generated pages escape owner text; public artifacts do not contain operational data", () => {
  const c = structuredClone(sample);
  c.name = '<script>alert("x")</script>';
  c.menus[0].name = "<img src=x onerror=alert(1)>";
  const output = artifacts(c, '<title>old</title><div id="root"></div>');
  assert.match(output["web/index.html"], /&lt;script&gt;/);
  assert.doesNotMatch(output["web/index.html"], /<script>alert/);
  assert.doesNotMatch(output["web/index.html"], /<img src=x/);
  const mock = JSON.parse(output["web/mock.json"]);
  assert.deepEqual(mock.bookings, []);
  assert.deepEqual(mock.inquiries, []);
  assert.equal(mock.writes, "discarded");
  const context = { window: {} as { __OMAIWEB_MOCK__?: unknown } };
  runInNewContext(output["web/data.js"], context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.__OMAIWEB_MOCK__)), mock);
  assert.deepEqual(JSON.parse(output["web/shop.json"]), mock.shop);
  assert.doesNotMatch(output["web/data.js"], /[<>&\u2028\u2029]/);
  assert.ok("admin/index.html" in output);
  assert.match(output["admin/system.svg"], /お店の仕組み図/);
  assert.doesNotMatch(output["admin/system.svg"], /<script>/);
  assert.ok("schema.md" in output);
  assert.throws(() =>
    renderShop({ ...c, hours: { ...c.hours, start: "22:00" } }, ""),
  );
});
test("Drive exports inline built code and CSS, keep data separate, and leave served/admin shells intact", () => {
  const shell = '<!doctype html><head><title>old</title><script type="module" crossorigin src="/assets/app.js"></script><link rel="modulepreload" href="/assets/shared.js"><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div></body>';
  const built: Record<string, string> = { "/assets/app.js": 'window.example = "</script>";', "/assets/app.css": 'body { color: green }' };
  const output = artifacts(sample, shell, path => { assert.ok(path in built); return built[path]; });
  const html = output["web/index.html"];
  assert.match(html, /<script src="\.\/data\.js"><\/script>/);
  assert.match(html, /<script type="module">window\.example/);
  assert.match(html, /<style>body \{ color: green \}<\/style>/);
  assert.doesNotMatch(html, /<link\b|\bsrc="\/assets\//);
  assert.deepEqual([...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]), ["./data.js"]);
  assert.doesNotMatch(html, /window\.__OMAIWEB_MOCK__\s*=/);
  assert.match(html, /<div id="root"><div class="public-shop"><h1>/);
  assert.doesNotMatch(html, /<noscript>/);
  assert.equal(output["admin/index.html"], shell);
  assert.doesNotMatch(renderShop(sample, shell), /data\.js/);
  assert.doesNotMatch(readFileSync("index.html", "utf8"), /data\.js/);
  assert.throws(() => artifacts(sample, shell.replace('/assets/app.js', 'https://example.com/app.js')), /同梱できない/);
  assert.throws(() => artifacts(sample, shell.replace('/assets/app.js', '/assets/../private.js')), /同梱できない/);
});
test("Drive mock startup requires file protocol and valid data, including safely escaped strings", () => {
  const config = structuredClone(sample); config.description = '</script><>&"\u2028\u2029';
  const output = artifacts(config, '<title></title><div id="root"></div>');
  const context = { window: {} as { __OMAIWEB_MOCK__?: unknown } };
  runInNewContext(output["web/data.js"], context);
  assert.deepEqual(drivePreviewData("file:", context.window.__OMAIWEB_MOCK__), driveMock(config));
  for (const protocol of ["http:", "https:"]) assert.equal(drivePreviewData(protocol, context.window.__OMAIWEB_MOCK__), undefined);
  for (const value of [undefined, null, {}, { ...driveMock(sample), mode: "live" }]) assert.equal(drivePreviewData("file:", value), undefined);
});
test("operational batch rollback discards outbox writes; refresh tokens reject tampering", async () => {
  const store = new Store(":memory:");
  await assert.rejects(() =>
    store.transaction(async () => {
      await store.put("job", "1", { type: "mail" });
      throw new Error("abort");
    }),
  );
  assert.equal(await store.get("job", "1"), undefined);
  void store.close();
  const token = encrypt("private-refresh-token");
  assert.ok(!token.includes("private-refresh-token"));
  assert.equal(decrypt(token), "private-refresh-token");
  const tampered = Buffer.from(token, "base64url");
  tampered[20] ^= 1;
  assert.throws(() => decrypt(tampered.toString("base64url")));
});
