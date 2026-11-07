import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { Store, type Shop } from "../server/store.ts";
import { sample, dateJST, slots, type Booking } from "../server/domain.ts";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
process.env.DEMO_MODE = "true";
process.env.APP_ORIGIN = "http://127.0.0.1";
test("approval, retired preview routes, publication, customer authorization, conflict locking, operations and invitations", async (t) => {
  const store = new Store(":memory:");
  const server = createApp(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => {
    server.close();
    void store.close();
  });
  async function request(path: string, data?: unknown, cookie = "") {
    const res = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  const login = await request("/api/demo-login", { role: "owner" });
  assert.equal(login.status, 200);
  const owner = login.cookie;
  const work = await request("/api/workspace", undefined, owner);
  const shop: Shop = work.body.shops[0];
  assert.equal(server.listenerCount("upgrade"),1,"only the assistant voice relay accepts WebSocket upgrades; the old interview relay stays removed");
  for(const action of ["interview","interview/turn","interview/plan","live","posts/source"]){
    assert.equal((await request(`/api/shops/${shop.id}/${action}`,undefined,owner)).status,404);
    assert.equal((await request(`/api/shops/${shop.id}/${action}`,{},owner)).status,404);
  }
  const worklet = await fetch(origin + "/live-audio.js");
  assert.equal(worklet.status, 200, "the assistant voice microphone worklet is served");
  assert.match(worklet.headers.get("content-type") || "", /javascript/);
  const c = structuredClone(sample);
  c.rules.cancelHours = 0;
  c.hours.closedWeekdays = [];
  const generated = await request(
    `/api/shops/${shop.id}/plan`,
    { text: "お店を作る", config: c },
    owner,
  );
  assert.equal(generated.status, 200);
  const plan = generated.body;
  const publish = `/api/shops/${shop.id}/plans/${plan.id}/publish`;
  assert.equal((await request(publish, {}, owner)).status, 409);
  assert.equal((await request(`/api/public/${shop.slug}`)).status, 404);
  assert.equal(
    (await request(`/api/preview/${shop.id}?plan=${plan.id}`, undefined, owner))
      .status,
    404,
  );
  await request(`/api/shops/${shop.id}/plans/${plan.id}/approve`, {}, owner);
  assert.equal((await request(`/api/preview/${shop.id}?plan=${plan.id}`, undefined, owner)).status, 404);
  const date = dateJST(new Date(Date.now() + 3 * 86400000));
  const slot = slots(c, [], date, "simple")[0];
  assert.ok(slot);
  assert.equal((await store.bookings(shop.id)).length, 0);
  assert.equal((await request(publish, { publication: "public" }, owner)).status, 200);
  assert.equal((await request(publish, {}, owner)).status, 200);
  assert.equal((await request(`/api/public/${shop.slug}`)).status, 200);
  const alice = (
    await request("/api/demo-login", {
      role: "customer",
      shopId: shop.id,
      email: "alice@example.com",
    })
  ).cookie;
  const bob = (
    await request("/api/demo-login", {
      role: "customer",
      shopId: shop.id,
      email: "bob@example.com",
    })
  ).cookie;
  assert.equal(
    (await request(`/api/shops/${shop.id}/operations`, undefined, alice))
      .status,
    403,
  );
  assert.equal(
    (await request(`/api/preview/${shop.id}?plan=${plan.id}`, undefined, alice))
      .status,
    404,
  );
  const bookingPath = `/api/public/${shop.slug}/bookings`;
  assert.equal((await request(bookingPath)).status, 401);
  const booking = { name: "Alice", message: "静かに過ごしたいです。", menuId: "simple", start: slot.start };
  assert.equal((await request(bookingPath, booking)).status, 401);
  assert.equal((await request(bookingPath, { ...booking, message: "x".repeat(2001) }, alice)).status, 400);
  const attempts = await Promise.all([
    request(bookingPath, booking, alice),
    request(bookingPath, booking, alice),
    request(bookingPath, booking, alice),
  ]);
  assert.deepEqual(attempts.map((a) => a.status).sort(), [200, 200, 409]);
  assert.equal((await store.bookings(shop.id)).length, 2);
  assert.equal(
    new Set((await store.bookings(shop.id)).map((b) => b.staffId)).size,
    2,
  );
  const b: Booking = attempts.find((a) => a.status === 200)!.body.booking;
  assert.equal(b.message, booking.message);
  assert.equal((await store.bookings(shop.id)).find(value => value.id === b.id)!.message, booking.message);
  assert.equal((await request(bookingPath, undefined, alice)).body[0].message, booking.message);
  assert.equal((await request(`/api/shops/${shop.id}/operations`, undefined, owner)).body.bookings[0].message, booking.message);
  assert.equal(b.price, c.menus.find(menu => menu.id === b.menuId)!.price);
  assert.equal((await request(bookingPath, undefined, bob)).body.length, 0);
  assert.equal(
    (await request(`${bookingPath}/${b.id}/cancel`, {}, bob)).status,
    404,
  );
  assert.equal(
    (await request(`${bookingPath}/${b.id}/cancel`, {}, alice)).status,
    200,
  );
  assert.equal((await store.bookings(shop.id)).length, 2);
  assert.equal(
    (await store.bookings(shop.id)).find((v) => v.id === b.id)!.status,
    "cancelled",
  );
  assert.equal(
    (
      await request(
        `/api/shops/${shop.id}/invite`,
        { email: "bob@example.com" },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/shops/${shop.id}/operations`, undefined, bob)).status,
    403,
  );
  assert.equal(
    (await request(`/api/invitations/${shop.id}/accept`, {}, bob)).status,
    200,
  );
  assert.equal(
    (await request(`/api/shops/${shop.id}/operations`, undefined, bob)).status,
    200,
  );
  assert.equal(
    (await request(`/api/shops/${shop.id}/plan`, { text: "変更" }, bob)).status,
    403,
  );
  const remaining = (await store.bookings(shop.id)).find(
    (b) => b.status === "active",
  )!;
  await request(
    `/api/shops/${shop.id}/bookings/${remaining.id}/status`,
    { status: "no_show" },
    bob,
  );
  assert.equal(
    (await store.bookings(shop.id)).find((b) => b.id === remaining.id)!.status,
    "no_show",
  );
  const inquiry = await request(
    `/api/public/${shop.slug}/inquiries`,
    { name: "Alice", message: "こんにちは" },
    alice,
  );
  assert.equal(inquiry.status, 200);
  const q = (
    await store.list<{
      id: string; email: string;
    }>("inquiry")
  )[0];
  assert.equal(
    (
      await request(
        `/api/shops/${shop.id}/inquiries/${q.id}/reply`,
        { text: "お待ちしています", previousEmail: q.email },
        bob,
      )
    ).status,
    200,
  );
  const nextTime = new Date(Date.parse(slot.start) + 4 * 3600000).toISOString();
  const requestId = "550e8400-e29b-41d4-a716-446655440000";
  const once = await request(
    bookingPath,
    { ...booking, start: nextTime, requestId },
    alice,
  );
  const twice = await request(
    bookingPath,
    { ...booking, start: nextTime, requestId },
    alice,
  );
  assert.equal(once.status, 200);
  assert.equal(twice.status, 200);
  assert.equal(once.body.booking.id, twice.body.booking.id);
  const next = structuredClone(c);
  next.hours.closedWeekdays = [3];
  next.menus.push({
    id: "new",
    name: "新コース",
    price: 9000,
    duration: 90,
    active: true,
  });
  next.staff[0].menuIds.push("new");
  const change = await request(
    `/api/shops/${shop.id}/plan`,
    { text: "水曜定休・新メニュー", config: next },
    owner,
  );
  assert.equal(change.status, 200);
  assert.equal((await store.shop(shop.id))!.published!.menus.length, 2);
  await request(
    `/api/shops/${shop.id}/plans/${change.body.id}/approve`,
    {},
    owner,
  );
  await request(
    `/api/shops/${shop.id}/plans/${change.body.id}/publish`,
    {},
    owner,
  );
  const docs = await request(
    `/api/shops/${shop.id}/documents`,
    undefined,
    owner,
  );
  assert.match(docs.body.spec, /新コース/);
  assert.match(docs.body.history, /営業時間・休業日を更新/);
  assert.equal((await store.shop(shop.id))!.history.length, 2);
  const paused = (await store.shop(shop.id))!;
  paused.publishingPlanId = "in-progress";
  await store.saveShop(paused);
  assert.equal((await request(`/api/public/${shop.slug}`)).status, 503);
  delete paused.publishingPlanId;
  await store.saveShop(paused);
  const csrf = await fetch(origin + `/api/shops/${shop.id}/invite`, {
    method: "POST",
    headers: { Cookie: owner, Origin: "https://attacker.example" },
    body: "{}",
  });
  assert.equal(csrf.status, 403);
  const guide = await fetch(origin + "/manual");
  assert.equal(guide.status, 200);
  assert.match(guide.headers.get("content-type") || "", /text\/html/);
  const guideImage = await fetch(origin + "/manual/01-start.jpg");
  assert.equal(guideImage.status, 200);
  assert.match(guideImage.headers.get("content-type") || "", /image\/jpeg/);
  assert.ok((await guideImage.arrayBuffer()).byteLength > 1000);
  const hostStatus = (host: string, path: string) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        origin + path,
        { headers: { host, Cookie: owner } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end();
    });
  assert.equal(await hostStatus("unknown.example", "/api/workspace"), 404);
  const hosted = (await store.shop(shop.id))!;
  hosted.domain = "salon.example.com";
  hosted.domainVerified = true;
  await store.saveShop(hosted);
  assert.equal(await hostStatus("salon.example.com", "/api/workspace"), 404);
  assert.equal(await hostStatus("salon.example.com", "/admin"), 404);
  assert.equal(await hostStatus("salon.example.com", "/manual"), 404);
  assert.equal(
    await hostStatus("salon.example.com", `/api/shops/${shop.id}/operations`),
    404,
  );
  assert.equal((await request(`/s/${shop.slug}/admin`)).status, 404);
});
