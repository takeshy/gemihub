import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { currentDomainConnection, domainReady } from "../server/custom-domain.ts";
import type { DomainConnection } from "../shared/custom-domain.ts";

const connection = (token: string): DomainConnection => ({
  domain: "reserve.example.com", generation: createHash("sha256").update(token).digest("hex"),
  status: "connected", address: "203.0.113.10", updatedAt: new Date().toISOString(),
});
test("only the current verified claim can use a completed domain connection", () => {
  const shop = { domain: "reserve.example.com", domainToken: "owner-token", domainVerified: true };
  assert.equal(currentDomainConnection(shop, connection("owner-token"))?.status, "connected");
  assert.equal(currentDomainConnection({ ...shop, domainVerified: false }, connection("owner-token")), undefined);
  assert.equal(currentDomainConnection({ ...shop, domain: "other.example.com" }, connection("owner-token")), undefined);
  assert.equal(currentDomainConnection(shop, connection("stale-token")), undefined);
});

test("self-service domains keep the existing URL until HTTPS connects; removal and ownership are enforced", async t => {
  const before = { ...process.env };
  process.env.DEMO_MODE = "true";
  process.env.CUSTOM_DOMAINS_ENABLED = "true";
  process.env.CUSTOM_DOMAIN_ADDRESS = "203.0.113.10";
  process.env.SITE_DOMAIN = "shops.gemihub.net";
  const store = new Store(":memory:");
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await store.close();
    for (const key of ["DEMO_MODE", "CUSTOM_DOMAINS_ENABLED", "CUSTOM_DOMAIN_ADDRESS", "SITE_DOMAIN", "APP_ORIGIN"])
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  });
  const login = await fetch(origin + "/api/demo-login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ role: "owner" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const workspace = async () => (await (await fetch(origin + "/api/workspace", { headers: { Cookie: cookie } })).json()).shops[0];
  const probeHost = () => new Promise<{status: number; body: unknown; cache: string | undefined}>((resolve, reject) => {
    const req = httpRequest(origin + "/.well-known/gemihub-domain", { headers: { Host: "reserve.example.com" } }, res => {
      let body = "";
      res.on("data", chunk => { body += String(chunk); });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(body), cache: res.headers["cache-control"] }));
    });
    req.on("error", reject); req.end();
  });
  const original = await workspace();
  const endpoint = `/api/shops/${original.id}/domain`;
  const post = (url: string, body: unknown, auth = cookie) => fetch(origin + url, { method: "POST", headers: { Cookie: auth, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post(endpoint, { domain: "reserve.example.com" })).status, 200);
  const shop = (await store.shop(original.id))!;
  const token = shop.domainToken!;
  shop.domainVerified = true;
  await store.saveShop(shop);
  assert.equal((await post(endpoint, { domain: "reserve.example.com" })).status, 200);
  assert.equal((await store.shop(shop.id))!.domainToken, token, "saving the same hostname must not invalidate existing DNS records");
  const pending = await workspace();
  assert.equal(pending.publicUrl, `https://${shop.slug}.shops.gemihub.net`);
  assert.equal(pending.domainAddress, "203.0.113.10");
  await store.put("domainConnection", shop.id, { ...connection(token), status: "certificate_pending" });
  assert.equal((await workspace()).publicUrl, pending.publicUrl);
  await store.put("domainConnection", shop.id, connection(token));
  assert.equal((await workspace()).publicUrl, "https://reserve.example.com");
  const probe = await probeHost();
  assert.equal(probe.status, 200);
  assert.deepEqual(probe.body, { shopId: shop.id, domain: shop.domain });
  assert.equal(probe.cache, "no-store");
  assert.equal((await post(endpoint, { domain: "kiokuflow.net" })).status, 409);
  assert.equal((await post(endpoint, { domain: "nested.shops.gemihub.net" })).status, 409);
  assert.notEqual((await post(endpoint + "/remove", {}, "")).status, 200);
  assert.equal((await post(endpoint + "/remove", {})).status, 200);
  assert.equal((await workspace()).domainConnection, undefined);
  assert.equal((await workspace()).publicUrl, pending.publicUrl);
  assert.equal((await probeHost()).status, 404);
  process.env.CUSTOM_DOMAINS_ENABLED = "false";
  assert.equal(domainReady({ ...shop, domainManaged: false }), true, "existing manual deployments retain their published URLs");
  assert.equal(domainReady(shop), false, "new claims require HTTPS even without a runtime flag");
});
