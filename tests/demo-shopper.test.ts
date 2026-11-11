import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { allowDemoShoppers, demoCustomerEmail } from "../server/auth.ts";
import { Store, type Shop } from "../server/store.ts";
import { sample } from "../server/domain.ts";

process.env.DEMO_MODE = "true";
allowDemoShoppers();

test("in demo mode a storefront visitor books as the registered demo customer without signing in", async t => {
  const store = new Store(":memory:");
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  const request = (path: string, data?: unknown, cookie = "") => fetch(origin + path, { method: data === undefined ? "GET" : "POST", redirect: "manual", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  const owner = (await request("/api/demo-login", { role: "owner", email: "owner@example.com" })).headers.get("set-cookie")!.split(";")[0];
  assert.equal((await (await request("/api/session", undefined, owner)).json()).aiName, "Gemini", "chat labels name the configured model family");
  const shop: Shop = (await (await request("/api/workspace", undefined, owner)).json()).shops[0];
  const plan = await (await request(`/api/shops/${shop.id}/plan`, { text: "入力した内容", config: structuredClone(sample) }, owner)).json();
  await request(`/api/shops/${shop.id}/plans/${plan.id}/approve`, {}, owner);
  assert.equal((await request(`/api/shops/${shop.id}/plans/${plan.id}/publish`, {}, owner)).status, 200);
  const storefront = `/api/public/${shop.slug}`;

  // The owner trying their provisional shop books as the demo customer and stays signed in as the owner.
  const asOwner = await (await request(storefront, undefined, owner)).json();
  assert.deepEqual(asOwner.demoCustomer, { email: demoCustomerEmail, name: "デモのお客様" });
  assert.equal(asOwner.registrationRequired, false, "the demo customer arrives registered");
  assert.equal(asOwner.canEdit, true);
  assert.deepEqual(await (await request(`${storefront}/bookings`, undefined, owner)).json(), []);
  assert.equal((await (await request("/api/session", undefined, owner)).json()).user.role, "owner");

  // Provisional access is still owner-only; the demo customer only replaces the customer sign-in.
  assert.equal((await request(storefront)).status, 401);
  const current = (await store.shop(shop.id))!;
  current.publication = "public";
  await store.saveShop(current);
  const anonymous = await (await request(storefront)).json();
  assert.equal(anonymous.demoCustomer.email, demoCustomerEmail);
  assert.equal((await request(`${storefront}/bookings`)).status, 200);

  // A customer who did sign in keeps their own identity.
  const guest = (await request("/api/demo-login", { role: "customer", email: "guest@example.com", shopId: shop.id })).headers.get("set-cookie")!.split(";")[0];
  const signedIn = await (await request(storefront, undefined, guest)).json();
  assert.equal(signedIn.demoCustomer, undefined);
  assert.equal(signedIn.registrationRequired, false);
});
