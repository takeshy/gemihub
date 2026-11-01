import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { createApp } from "../server/app.ts";
import { Store, type Shop } from "../server/store.ts";
import { sample } from "../server/domain.ts";

process.env.DEMO_MODE = "true";

test("provisional HTML, pages, posts, images and APIs require the owner; full publication removes only the viewing restriction", async t => {
  const store = new Store(":memory:");
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  async function request(path: string, data?: unknown, cookie = "", host?: string) {
    if (host) return new Promise<Response>((resolve, reject) => {
      const req = httpRequest(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Host: host, Origin: origin, Cookie: cookie, "Content-Type": "application/json" } }, res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
        });
      });
      req.on("error", reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
    return fetch(origin + path, { method: data === undefined ? "GET" : "POST", redirect: "manual", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", ...(host ? { Host: host } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  }
  const owner = (await request("/api/demo-login", { role: "owner", email: "owner@example.com" })).headers.get("set-cookie")!.split(";")[0];
  const shop: Shop = (await (await request("/api/workspace", undefined, owner)).json()).shops[0];
  const base = `/api/shops/${shop.id}`;
  const config = structuredClone(sample);
  config.pages = [{ id: "private-page", slug: "private", title: "OWNER ONLY PAGE", navigationLabel: "内覧", body: "OWNER ONLY CONTENT", layout: "standard", imageUrl: "" }];
  const plan = await (await request(`${base}/plan`, { text: "入力した内容", config }, owner)).json();
  await request(`${base}/plans/${plan.id}/approve`, {}, owner);
  assert.equal((await request(`${base}/plans/${plan.id}/publish`, {}, owner)).status, 200);
  const current = (await store.shop(shop.id))!;
  assert.equal(current.publication, "provisional", "first publication defaults to owner-only access");
  current.domain = "private.example.test"; current.domainVerified = true;
  await store.saveShop(current);
  const guest = (await request("/api/demo-login", { role: "customer", email: "guest@example.com", shopId: shop.id })).headers.get("set-cookie")!.split(";")[0];
  const member = (await request("/api/demo-login", { role: "customer", email: "member@example.com", shopId: shop.id })).headers.get("set-cookie")!.split(";")[0];
  await store.put("member", `${shop.id}:member@example.com`, { shopId: shop.id, email: "member@example.com", accepted: true, status: "accepted" });
  for (const path of ["", "/slots?date=2026-11-02&menu=simple", "/posts", "/posts/blogs/secret", "/images/" + "a".repeat(64), "/menu-images/" + "a".repeat(64), "/bookings"]) {
    const denied = await request(`/api/public/${shop.slug}${path}`);
    assert.equal(denied.status, 401, path);
    assert.doesNotMatch(await denied.text(), /OWNER ONLY/);
    assert.equal((await request(`/api/public/${shop.slug}${path}`, undefined, guest)).status, 403, path);
    assert.equal((await request(`/api/public/${shop.slug}${path}`, undefined, member)).status, 403, path);
  }
  assert.equal((await request(`/api/public/${shop.slug}`, undefined, owner)).status, 200);
  assert.equal((await request(`/api/public/${shop.slug}`, undefined, "", current.domain)).status, 401);
  for (const path of [`/s/${shop.slug}`, `/s/${shop.slug}/pages/private`, `/s/${shop.slug}/blogs`]) {
    const anonymous = await request(path);
    assert.equal(anonymous.status, 302);
    assert.match(anonymous.headers.get("location")!, /auth\/google\?shop=/);
    assert.equal(anonymous.headers.get("cache-control"), "no-store");
    assert.equal((await request(path, undefined, guest)).status, 403);
  }
  const page = await request(`/s/${shop.slug}/pages/private`, undefined, owner);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /OWNER ONLY CONTENT/);
  assert.match(page.headers.get("cache-control")!, /no-store/);
  assert.equal(page.headers.get("vary"), "Cookie, X-Omaiweb-Language");
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  const customAnonymous = await request("/pages/private", undefined, "", current.domain);
  assert.equal(customAnonymous.status, 302);
  assert.match(customAnonymous.headers.get("location")!, /host=private\.example\.test/);
  assert.equal((await request("/pages/private", undefined, guest, current.domain)).status, 403);
  assert.equal((await request("/pages/private", undefined, owner, current.domain)).status, 200);
  assert.equal((await request(`/api/public/${shop.slug}/bookings`, { menuId: "simple", start: "2026-11-02T01:00:00Z", name: "guest" }, guest)).status, 403);
  assert.equal((await request(`${base}/publication`, { publication: "public", revision: current.revision }, member)).status, 403);
  assert.equal((await request(`${base}/publication-preview`, undefined, guest)).status, 403);
  assert.equal((await request(`/publication-preview/${shop.id}`)).status, 403);
  assert.equal((await request(`/publication-preview/${shop.id}`, undefined, guest)).status, 403);
  const previewPage = await request(`/publication-preview/${shop.id}`, undefined, owner);
  assert.equal(previewPage.status, 200);
  assert.match(previewPage.headers.get("cache-control")!, /no-store/);
  const snapshot = await (await request(`${base}/publication-preview`, undefined, owner)).json();
  assert.equal((await request(`${base}/publication`, { publication: "public", revision: current.revision - 1, hash: snapshot.hash }, owner)).status, 409);
  assert.equal((await request(`${base}/publication`, { publication: "public", revision: current.revision, hash: snapshot.hash }, owner)).status, 200);
  assert.equal((await request(`/api/public/${shop.slug}`)).status, 200);
  assert.equal((await request(`/s/${shop.slug}/pages/private`)).status, 200);
  assert.equal((await request("/pages/private", undefined, "", current.domain)).status, 200);
  assert.equal((await request(`/api/public/${shop.slug}/bookings`)).status, 401, "full publication still requires a customer login for personal bookings");
  assert.equal((await request(`/api/preview/${shop.id}?plan=${plan.id}`, undefined, owner)).status, 404);
});
