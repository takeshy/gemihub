import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample, dateJST } from "../server/domain.ts";
import { aggregateCustomers, customerSummaries } from "../server/customers.ts";

process.env.DEMO_MODE = "true";
test("verified customers register their own profile before booking; profiles stay private", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); shop.publication = "public"; shop.revision = 1;
  await store.saveShop(shop);
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  for (const id of ["alice", "bob", "owner", "other-shop"]) await store.put("session", digest(id), { user: {email: `${id}@example.com`, name: `Google ${id}`, role: id === "owner" ? "owner" : "customer", shopId: id === "other-shop" ? "other" : shop.id}, expires: Date.now() + 600000 });
  const base = `/api/public/${shop.slug}`;
  async function api(path: string, data?: unknown, user = "alice") {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: user ? `gemihub_session=${user}` : "", "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return {status: response.status, body: await response.json()};
  }
  assert.equal((await api(`${base}/profile`, undefined, "")).status, 401);
  assert.equal((await api(`${base}/profile`, undefined, "other-shop")).status, 401);
  assert.equal((await api(base)).body.registrationRequired, true);
  assert.equal((await api(`${base}/bookings`, {})).status, 428);
  assert.equal((await api(`${base}/inquiries`, {name: "Alice", message: "Hello"})).status, 428);
  const profile = {name: "登録したお名前", birthDate: "1995-02-28", gender: "not_specified"};
  for (const invalid of [{...profile, name: " "}, {...profile, birthDate: "1995-02-29"}, {...profile, birthDate: "2999-01-01"}, {...profile, gender: "invalid"}]) assert.equal((await api(`${base}/profile`, invalid)).status, 400);
  assert.equal((await api(`${base}/profile`, {...profile, email: "bob@example.com"})).status, 200);
  assert.equal((await store.get("customer", `${shop.id}:bob@example.com`)), undefined);
  assert.deepEqual((await api(`${base}/profile`)).body.profile, profile);
  assert.equal((await api(base)).body.registrationRequired, false);
  assert.deepEqual((await api(base)).body.customerProfile, profile);
  assert.equal((await api(`${base}/profile`, undefined, "bob")).body.profile, null);
  for (const user of ["", "bob", "owner"]) assert.doesNotMatch(JSON.stringify((await api(base, undefined, user)).body), /登録したお名前|1995-02-28/);
  const list = (await api(`/api/shops/${shop.id}/customers`, undefined, "owner")).body;
  assert.equal(list[0].name, profile.name);
  assert.doesNotMatch(JSON.stringify(list), /birthDate|gender/);
  assert.deepEqual((await api(`/api/shops/${shop.id}/customers/alice%40example.com`, undefined, "owner")).body.profile, profile);
  assert.equal((await api(`/api/shops/${shop.id}/customers/alice%40example.com`, undefined, "bob")).status, 403);
  assert.equal((await api(`${base}/inquiries`, {name: profile.name, message: "問い合わせの確認"})).status, 200);
  let date = new Date(Date.now() + 3 * 86400000);
  // The requested date is shop-local: the UTC weekday differs around midnight.
  while (sample.hours.closedWeekdays.includes(new Date(`${dateJST(date)}T00:00:00Z`).getUTCDay())) date = new Date(date.getTime() + 86400000);
  const slots = (await api(`${base}/slots?date=${dateJST(date)}&menu=${sample.menus[0].id}`)).body;
  assert.ok(slots.length);
  assert.equal((await api(`${base}/bookings`, {name: profile.name, menuId: sample.menus[0].id, start: slots[0].start})).status, 200);
  assert.equal((await store.bookings(shop.id))[0].name, profile.name);
});

test("registration-only customers appear in CRM without exposing profile fields in summaries", () => {
  const records = [{shopId: "shop", email: "alice@example.com", name: "登録済み", birthDate: "1990-01-01", gender: "female" as const, updatedBy: "alice@example.com", updatedAt: "2026-11-01T00:00:00Z"}];
  const customers = aggregateCustomers([], [], [], new Date(), undefined, records);
  assert.equal(customers[0].profile?.birthDate, records[0].birthDate);
  assert.equal(customerSummaries(customers)[0].visitCount, 0);
  assert.doesNotMatch(JSON.stringify(customerSummaries(customers)), /birthDate|gender/);
});
