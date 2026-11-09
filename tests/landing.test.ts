import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { requestLocale } from "../server/i18n.ts";
import { renderLanding } from "../server/landing.ts";

test("LP HTML contains localized content and metadata before JavaScript runs", () => {
  const shell = '<html lang="ja"><head><title>App</title></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
  for (const locale of ["ja", "en"] as const) {
    const html = requestLocale.run(locale, () => renderLanding(shell));
    assert.ok(html.includes(`lang="${locale}"`));
    assert.match(html, /data-page="lp"/);
    assert.match(html, /<h1[^>]*>/);
    assert.match(html, /name="description"/);
    assert.match(html, /property="og:title"/);
    assert.ok(html.includes(`rel="canonical" href="https://gemihub.net/lp${locale === "en" ? "?lang=en" : ""}"`));
    assert.ok(html.includes(`href="/?lang=${locale}"`));
    assert.match(html, /src="\/assets\/app.js"/);
    assert.ok(html.includes(locale === "ja" ? "お店のシステムを、" : "Your shop’s system,"));
    assert.ok(!html.includes("/api/"));
    assert.match(html, /<section id="payments"/);
    assert.ok(html.indexOf('id="payments"') < html.indexOf('id="operations"'));
    assert.match(html, /data-feature="customers"/);
    assert.match(html, /data-feature="analytics"/);
    assert.ok(html.includes(locale === "ja" ? "お客様情報" : "Customer records"));
    assert.ok(html.includes(locale === "ja" ? "売上・アクセス分析" : "Sales &amp; traffic"));
  }
});

test("LP is public on the management host without database/session access; other hosts cannot serve it", async t => {
  const previous = process.env.APP_ORIGIN;
  const store = new Store(":memory:");
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await store.close();
    if (previous === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previous;
  });
  const unavailable = mock.method(store, "list", async () => { throw new Error("Database unavailable"); });
  try {
    const english = await fetch(base + "/lp?lang=en", { headers: { Cookie: "gemihub_locale=ja" } });
    assert.equal(english.status, 200);
    assert.equal(english.headers.get("Content-Language"), "en");
    assert.match(english.headers.get("Content-Type")!, /text\/html/);
    assert.match(english.headers.get("Content-Security-Policy")!, /frame-ancestors 'none'/);
    assert.match(await english.text(), /Your shop’s system,/);
    const video = await fetch(base + "/lp/gemihub-demo-1min-en.mp4", { headers: { Range: "bytes=0-99" } });
    if (video.status !== 404) { // Present once the app has been built.
      assert.equal(video.status, 206);
      assert.equal(video.headers.get("Content-Type"), "video/mp4");
      assert.match(video.headers.get("Content-Range")!, /^bytes 0-99\/\d+$/);
      assert.equal((await video.arrayBuffer()).byteLength, 100);
    }
    const head = await fetch(base + "/lp", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(unavailable.mock.callCount(), 0);
  } finally { unavailable.mock.restore(); }
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(base + "/lp", { headers: { Host: "unregistered.example.test" } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.end();
  });
  assert.equal(wrongHost, 404);
  assert.equal((await fetch(base + "/lp", { method: "POST", headers: { Origin: base } })).status, 405);
});
