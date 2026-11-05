import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { encrypt } from "../server/google.ts";
import { Store, type Shop } from "../server/store.ts";
import { bookingDates, sample, shopSchema, type Booking } from "../server/domain.ts";
import { queueWaitlistNotices, readWaitlistOpenings, slotNoticeCooldownMs, slotWishInputSchema, waitlistBaseline, wishError, type SlotWish, type WaitlistListing, type WaitlistSlot } from "../server/waitlist.ts";

const at = (time: string) => new Date(`2026-11-20T${time}:00+09:00`).toISOString();
const slot = (time: string, end: string) => ({ start: at(time), end: at(end) });
const now = Date.parse("2026-11-10T00:00:00+09:00");
const listing = (fields: Partial<WaitlistListing> = {}): WaitlistListing => ({
  id: "listing-1", bookingId: "booking-1", seller: "seller@example.com", ...slot("11:00", "12:00"), menuId: "simple", staffId: "aoi",
  menu: "Cut", price: 3000, currency: "JPY", discountPercent: 50, deadline: at("10:00"), busy: false, ...fields,
});
async function setup(wish: Partial<SlotWish> = {}, initial: { open?: WaitlistSlot[]; listings?: WaitlistListing[] } = {}) {
  const store = new Store(":memory:");
  const shop: Shop = { ...await store.createShop("owner@example.com"), slug: "shop", published: shopSchema.parse(structuredClone(sample)), google: { folderId: "folder" } as Shop["google"] };
  await store.saveShop(shop);
  const value: SlotWish = { id: "wish-1", shopId: shop.id, customer: "wait@example.com", name: "Wait", locale: "ja", createdAt: new Date(now).toISOString(), date: "2026-11-20", from: "10:00", to: "20:00", menuId: "simple", optionIds: [], discountOnly: false, ...wish };
  value.seen ??= waitlistBaseline(shop.published!, value, initial.open || [], initial.listings || [], now);
  await store.put("slotWish", value.id, value);
  const mails: { id: string; to: string; cc: string[]; subject: string; body: string }[] = [];
  let open: WaitlistSlot[] | Error = initial.open || [], listings: WaitlistListing[] = initial.listings || [];
  const check = async (time = now) => queueWaitlistNotices(store, shop, {
    openings: await readWaitlistOpenings(store, shop, async () => { if (open instanceof Error) throw open; return open; }),
    listings: async () => listings,
    enqueue: async (id, mail) => { mails.push({ id, ...mail }); },
  }, time);
  return { store, shop, mails, check, wish: () => store.get<SlotWish>("slotWish", value.id), setOpen: (value: WaitlistSlot[] | Error) => { open = value; }, setListings: (value: WaitlistListing[]) => { listings = value; } };
}

test("what was open at registration is not mailed; a later opening is, to the customer alone", async () => {
  const t = await setup({}, { open: [slot("10:00", "11:00")] });
  await t.check();
  assert.equal(t.mails.length, 0);
  t.setOpen([slot("10:00", "11:00"), slot("15:00", "16:00")]);
  await t.check(now + 60000);
  assert.equal(t.mails.length, 1);
  assert.equal(t.mails[0].to, "wait@example.com");
  assert.deepEqual(t.mails[0].cc, []);
  assert.match(t.mails[0].body, /2026\/11\/20 10:00〜20:00/);
  assert.match(t.mails[0].body, /15:00/);
  assert.doesNotMatch(t.mails[0].body, /10:00(, |$)/m);
  await t.check(now + 120000);
  assert.equal(t.mails.length, 1, "the same opening is not mailed twice");
});

test("an opening or discounted listing appearing before the first worker check is mailed", async () => {
  const t = await setup();
  t.setOpen([slot("15:00", "16:00")]);
  t.setListings([listing()]);
  await t.check(now + 60000);
  assert.equal(t.mails.length, 1);
  assert.match(t.mails[0].body, /15:00/);
  assert.match(t.mails[0].body, /50%引き/);
  await t.check(now + 120000);
  assert.equal(t.mails.length, 1);

  const discounted = await setup({ discountOnly: true }, { listings: [listing()] });
  await discounted.check(now + 60000);
  assert.equal(discounted.mails.length, 0, "an existing discounted listing belongs to the registration baseline");
  discounted.setListings([listing(), listing({ id: "new-listing" })]);
  await discounted.check(now + 120000);
  assert.equal(discounted.mails.length, 1);
});

test("slots outside the requested range do not match, including ones ending after it", async () => {
  const t = await setup({ from: "12:00", to: "15:00" });
  await t.check();
  t.setOpen([slot("11:30", "12:30"), slot("14:30", "15:30")]);
  await t.check(now + 60000);
  assert.equal(t.mails.length, 0);
  t.setOpen([slot("14:00", "15:00")]);
  await t.check(now + 120000);
  assert.equal(t.mails.length, 1);
});

test("a time that fills and reopens is mailed again, but only after the cooldown", async () => {
  const t = await setup();
  await t.check();
  t.setOpen([slot("15:00", "16:00")]);
  await t.check(now + 60000);
  t.setOpen([]);
  await t.check(now + 120000);
  t.setOpen([slot("15:00", "16:00")]);
  await t.check(now + 180000);
  assert.equal(t.mails.length, 1, "held back by the cooldown");
  await t.check(now + 60000 + slotNoticeCooldownMs);
  assert.equal(t.mails.length, 2, "still open, so it goes out when the cooldown ends");
});

test("a discounted appointment skips the cooldown and hides the seller", async () => {
  const t = await setup();
  await t.check();
  t.setOpen([slot("15:00", "16:00")]);
  await t.check(now + 60000);
  t.setListings([listing()]);
  await t.check(now + 120000);
  assert.equal(t.mails.length, 2);
  assert.match(t.mails[1].subject, /お得な空き枠/);
  assert.match(t.mails[1].body, /50%引き/);
  assert.doesNotMatch(t.mails[1].body, /seller/);
});

test("discounted appointments match the service and staff, not someone else's payment or the customer's own", async () => {
  const t = await setup({ staffId: "aoi", discountOnly: true });
  await t.check();
  t.setOpen([slot("15:00", "16:00")]);
  t.setListings([listing({ id: "a", menuId: "other" }), listing({ id: "b", staffId: "ren" }), listing({ id: "c", busy: true }), listing({ id: "d", seller: "wait@example.com" }), listing({ id: "e", ...slot("20:00", "21:00") })]);
  await t.check(now + 60000);
  assert.equal(t.mails.length, 0, "ordinary slots are ignored too");
  t.setListings([listing({ id: "c" })]);
  await t.check(now + 120000);
  assert.equal(t.mails.length, 1, "a listing is mailed once the other customer's payment lapses");
});

test("a mailed listing is not mailed again when someone's payment on it lapses", async () => {
  const t = await setup({ discountOnly: true });
  await t.check();
  t.setListings([listing()]);
  await t.check(now + 60000);
  assert.equal(t.mails.length, 1);
  t.setListings([listing({ busy: true })]);
  await t.check(now + 120000);
  t.setListings([listing()]);
  await t.check(now + 180000);
  assert.equal(t.mails.length, 1);
});

test("an unreadable calendar leaves the alert for the next check", async () => {
  const t = await setup();
  await t.check();
  const before = await t.wish();
  t.setOpen(new Error("calendar"));
  const error = console.error;
  console.error = () => {};
  try { await t.check(now + 60000); } finally { console.error = error; }
  assert.deepEqual(await t.wish(), before);
  assert.equal(t.mails.length, 0);
});

test("an alert ends when its range passes or the customer books inside it", async () => {
  const past = await setup();
  await past.check(Date.parse(at("20:00")));
  assert.equal(await past.wish(), undefined);
  const t = await setup();
  const booking = { id: "b1", shopId: t.shop.id, customer: "wait@example.com", name: "Wait", menuId: "simple", staffId: "aoi", ...slot("11:00", "12:00"), status: "active", createdAt: new Date(now).toISOString() } as Booking;
  await t.store.saveBooking(booking);
  t.setListings([listing({ seller: "wait@example.com", bookingId: "b1" })]);
  await t.check();
  assert.ok(await t.wish(), "their own booking awaiting a replacement does not count");
  t.setListings([]);
  await t.check();
  assert.equal(await t.wish(), undefined);
});

test("a booking held since before the alert does not end it; one bought after does", async () => {
  const t = await setup();
  const booking = { id: "b1", shopId: t.shop.id, customer: "wait@example.com", name: "Wait", menuId: "simple", staffId: "aoi", ...slot("15:00", "16:00"), status: "active", createdAt: new Date(now - 60000).toISOString() } as Booking;
  await t.store.saveBooking(booking);
  await t.check();
  assert.ok(await t.wish(), "they may be asking to move it");
  await t.store.saveBooking({ ...booking, transfers: [{ at: new Date(now + 60000).toISOString() }] as Booking["transfers"] });
  await t.check(now + 120000);
  assert.equal(await t.wish(), undefined);
});

test("an alert for a menu the shop stopped offering ends with a mail in the customer's language", async () => {
  const t = await setup({ locale: "en", optionIds: ["gone"] });
  await t.check();
  assert.equal(await t.wish(), undefined);
  assert.equal(t.mails.length, 1);
  assert.equal(t.mails[0].to, "wait@example.com");
  assert.match(t.mails[0].body, /no longer offers/);
  assert.doesNotMatch(t.mails[0].body, /gone/);
});

test("a notice names the staff in the alert's language and links to the shop's own host", async () => {
  const t = await setup({ locale: "en", discountOnly: true });
  t.shop.domain = "shop.example.com";
  t.shop.domainVerified = true;
  await t.store.saveShop(t.shop);
  await t.check();
  t.setListings([listing({ staffId: "owner" })]);
  await t.check(now + 60000);
  assert.match(t.mails[0].body, /Cut \/ Owner/);
  assert.match(t.mails[0].body, /https:\/\/shop\.example\.com\/\?pane=reserve&lang=en/);
});

test("alert input is limited to a real range inside the booking window", () => {
  assert.equal(slotWishInputSchema.safeParse({ date: "2026-11-20", from: "20:00", to: "10:00", menuId: "simple" }).success, false);
  const parsed = slotWishInputSchema.parse({ date: "2026-11-20", from: "10:00", to: "20:00", menuId: "simple" });
  assert.equal(wishError(sample, parsed, ["2026-11-20"]), undefined);
  assert.ok(wishError(sample, parsed, ["2026-11-21"]));
  assert.ok(wishError(sample, { ...parsed, menuId: "missing" }, ["2026-11-20"]));
});

test("customers save, list and stop only their own alerts", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  const request = (path: string, data?: unknown, cookie = "") => fetch(origin + path, { method: data === undefined ? "GET" : "POST", redirect: "manual", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const login = async (data: unknown) => (await request("/api/demo-login", data)).headers.get("set-cookie")!.split(";")[0];
  const owner = await login({ role: "owner", email: "owner@example.com" });
  const created: Shop = (await (await request("/api/workspace", undefined, owner)).json()).shops[0];
  const shop = (await store.shop(created.id))!;
  const config = structuredClone(sample);
  config.menus.push(...["addon-a", "addon-b"].map(id => ({ id, name: id, duration: 15, price: 500, active: true, optionFor: ["simple"] })));
  await store.saveShop({ ...shop, slug: "alerts", published: config, publication: "public" });
  const customer = async (email: string) => {
    const cookie = await login({ role: "customer", email, shopId: shop.id });
    await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name: email, birthDate: "1990-01-01", gender: "not_specified" });
    return cookie;
  };
  const [alice, bob] = [await customer("alice@example.com"), await customer("bob@example.com")];
  const base = "/api/public/alerts/waitlist";
  const date = bookingDates(sample).at(-1)!;
  const wish = { date, from: "10:00", to: "18:00", menuId: "simple" };
  assert.equal((await request(base, wish)).status, 401, "signed-out visitors cannot register");
  assert.equal((await request(base, { ...wish, date: "2020-01-01" }, alice)).status, 400);
  const { id } = await (await request(base, wish, alice)).json();
  const registered = (await store.get<SlotWish>("slotWish", id))!;
  const slots = await (await request(`/api/public/alerts/slots?date=${date}&menu=simple`)).json() as WaitlistSlot[];
  assert.deepEqual(registered.seen, waitlistBaseline(config, registered, slots, []), "registration persists the current availability before a worker runs");
  assert.equal((await (await request(base, wish, alice)).json()).id, id, "the same alert is not duplicated");
  for (let hour = 10; hour < 19; hour++) assert.equal((await request(base, { ...wish, from: `${hour}:00`, to: "19:00" }, alice)).status, 200);
  assert.equal((await request(base, { ...wish, from: "09:30" }, alice)).status, 409, "ten alerts per customer");
  assert.deepEqual(await (await request(base, undefined, bob)).json(), []);
  await request(`${base}/${id}/remove`, {}, bob);
  assert.ok(await store.get("slotWish", id), "another customer cannot stop it");
  await request(`${base}/${id}/remove`, {}, alice);
  assert.equal(await store.get("slotWish", id), undefined);

  const addOns = { ...wish, optionIds: ["addon-b", "addon-a"] };
  const { id: addOnId } = await (await request(base, addOns, bob)).json();
  assert.deepEqual((await store.get<SlotWish>("slotWish", addOnId))!.optionIds, ["addon-a", "addon-b"]);
  assert.equal((await (await request(base, { ...addOns, optionIds: ["addon-a", "addon-b"] }, bob)).json()).id, addOnId);
  // Existing records may still have the order stored before normalization was added.
  const legacy = (await store.get<SlotWish>("slotWish", addOnId))!;
  await store.put("slotWish", addOnId, { ...legacy, optionIds: ["addon-b", "addon-a"] });
  assert.equal((await (await request(base, { ...addOns, optionIds: ["addon-a", "addon-b"] }, bob)).json()).id, addOnId);
  assert.equal((await (await request(base, undefined, bob)).json()).length, 1);
});

test("first worker notices a post-registration opening; stopping a failed delivery discards only that wish's mail", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.published.hours.closedWeekdays = [];
  const staff = shop.published.staff.find(s => s.id === "aoi")!;
  staff.weekdays = [0, 1, 2, 3, 4, 5, 6];
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  await store.put("user", shop.owner, { email: shop.owner, role: "owner", refreshToken: encrypt("refresh") });
  await store.put("calendar", "owner", { shopId: shop.id, email: shop.owner, staffId: "aoi", refreshToken: "test" });
  for (const name of ["alice", "bob"]) {
    const email = `${name}@example.com`;
    await store.put("session", digest(name), { user: { email, role: "customer", shopId: shop.id }, expires: Date.now() + 600000 });
    await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name, birthDate: "1990-01-01", gender: "not_specified" });
  }
  const date = bookingDates(shop.published).at(-1)!;
  let busy = [{ start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` }];
  const sent: string[] = [];
  let failing = true;
  t.mock.method(google, "gmail", (() => ({ users: { messages: { async send(input: { requestBody: { raw: string } }) {
    if (failing) throw new Error("temporary Gmail failure");
    sent.push(Buffer.from(input.requestBody.raw, "base64url").toString());
  } } } })) as never);
  t.mock.timers.enable({ apis: ["setInterval"] });
  const server = createApp(store, undefined, { exchange: async () => { throw new Error("unused"); }, busy: async () => busy });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const call = async (path: string, input: unknown, name: string) => {
    const response = await fetch(`${origin}/api/public/${shop.slug}/waitlist${path}`, { method: "POST", headers: { Origin: origin, Cookie: `gemihub_session=${name}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const input = { date, from: "00:00", to: "23:59", menuId: "simple", staffId: "aoi" };
  const alice = await call("", input, "alice");
  const bob = await call("", input, "bob");
  assert.deepEqual((await store.get<SlotWish>("slotWish", alice.id))!.seen, []);
  busy = [];
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 300; i++) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("worker did not reach the expected state");
  };
  t.mock.timers.tick(60000);
  await until(async () => (await store.list<{ attempts: number }>("job")).filter(j => j.attempts > 0).length === 2);
  assert.deepEqual((await store.list<{ wishId: string }>("job")).map(j => j.wishId).sort(), [alice.id, bob.id].sort());
  await call(`/${alice.id}/remove`, {}, "alice");
  failing = false;
  t.mock.timers.tick(60000);
  await until(async () => (await store.list("job")).length === 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^To: bob@example.com\r\n/);
});
