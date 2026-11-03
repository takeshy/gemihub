import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample, shopSchema } from "../server/domain.ts";
import { liveValue, updateLiveValue } from "../server/live-settings.ts";
import { mapEmbedUrl, mapOpenUrl, mapQuery } from "../src/GoogleMap.tsx";

process.env.DEMO_MODE = "true";

test("the access map is opt-in, uses the address unless a place is given, and only Google Maps may be framed", async t => {
  assert.equal(shopSchema.parse(sample).map, undefined, "existing shops show no map until the owner turns it on");
  const withMap = updateLiveValue(sample, "basic", { ...liveValue(sample, "basic"), map: { enabled: true, query: "" } });
  assert.deepEqual(withMap.map, { enabled: true, query: "" });
  assert.equal(mapQuery(withMap), sample.address, "a blank place falls back to the address");
  assert.equal(mapQuery({ ...withMap, map: { enabled: true, query: "東京都江東区森下4-25-4" } }), "東京都江東区森下4-25-4");
  assert.match(mapEmbedUrl("東京都 江東区&森下"), /^https:\/\/maps\.google\.com\/maps\?q=%E6%9D%B1%E4%BA%AC%E9%83%BD%20%E6%B1%9F%E6%9D%B1%E5%8C%BA%26%E6%A3%AE%E4%B8%8B&hl=(ja|en)&z=16&output=embed$/);
  assert.equal(mapOpenUrl("A&B"), "https://www.google.com/maps/search/?api=1&query=A%26B");
  assert.throws(() => shopSchema.parse({ ...sample, map: { enabled: true, query: "x".repeat(301) } }));

  const store = new Store(":memory:");
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.close(); await store.close(); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/session`);
  const policy = response.headers.get("content-security-policy") || "";
  assert.match(policy, /frame-src https:\/\/www\.google\.com https:\/\/maps\.google\.com;/);
  assert.match(policy, /frame-ancestors 'none'/, "gemihub itself still cannot be framed");
});
