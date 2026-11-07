import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { sample, type Booking } from "../server/domain.ts";
import { mirrorEventId, removeStaffCalendar, syncStaffCalendars } from "../server/calendar-mirror.ts";
import type { CalendarConnection, CalendarGateway, CalendarMirrorGateway, MirrorEvent } from "../server/calendar.ts";

function fakeGoogle() {
  const calendars = new Map<string, { owner: string; events: Map<string, MirrorEvent> }>();
  const calls: string[] = [];
  let created = 0;
  let deny: string | undefined;
  let fail = false;
  const check = (connection: CalendarConnection) => {
    if (deny === connection.email) throw Object.assign(new Error("insufficient scopes"), { response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } });
    if (fail) throw Object.assign(new Error("backend"), { response: { status: 503 } });
  };
  const mirror: CalendarMirrorGateway = {
    async ensureCalendar(connection, calendarId) {
      check(connection);
      if (calendarId && calendars.has(calendarId)) return calendarId;
      const id = `cal-${++created}`;
      calendars.set(id, { owner: connection.email, events: new Map() });
      calls.push(`create ${id}`);
      return id;
    },
    async listEvents(connection, calendarId, timeMin) {
      check(connection);
      return [...calendars.get(calendarId)!.events.values()].filter(event => event.end >= timeMin);
    },
    async putEvent(connection, calendarId, event) {
      check(connection);
      calendars.get(calendarId)!.events.set(event.id, event);
      calls.push(`put ${event.id}`);
    },
    async deleteEvent(connection, calendarId, eventId) {
      check(connection);
      calendars.get(calendarId)!.events.delete(eventId);
      calls.push(`delete ${eventId}`);
    },
    async deleteCalendar(connection, calendarId) {
      check(connection);
      calendars.delete(calendarId);
      calls.push(`drop ${calendarId}`);
    },
  };
  const gateway: CalendarGateway = { async exchange() { throw new Error("unused"); }, async busy() { return []; }, mirror };
  return { gateway, calendars, calls, setDeny: (email?: string) => { deny = email; }, setFail: (value: boolean) => { fail = value; } };
}

async function shopWithStaff() {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  await store.saveShop(shop);
  const email = "aoi@example.com";
  await store.put("member", `${shop.id}:${email}`, { shopId: shop.id, email, accepted: true, status: "accepted" });
  await store.put("calendar", `${shop.id}:${email}`, { shopId: shop.id, email, staffId: "aoi", refreshToken: "token-1" } satisfies CalendarConnection);
  return { store, shop, email };
}

const booking = (shopId: string, id: string, start: string, extra: Partial<Booking> = {}): Booking => ({
  id, shopId, customer: "guest@example.com", name: "Hanako", menuId: "simple", price: 5000, message: "", staffId: "aoi",
  start, end: new Date(Date.parse(start) + 3600000).toISOString(), status: "active", createdAt: start, ...extra,
});

test("each staff member's active bookings are mirrored to a secondary calendar and kept in sync", async t => {
  const { store, shop, email } = await shopWithStaff();
  t.after(() => store.close());
  const google = fakeGoogle();
  const now = new Date("2026-11-10T00:00:00Z");
  await store.saveBooking(booking(shop.id, "b1", "2026-11-11T01:00:00Z", { message: "Short nails, please", customer: "tel:+819012345678", phone: "+819012345678" }));
  await store.saveBooking(booking(shop.id, "b2", "2026-11-12T01:00:00Z"));
  await store.saveBooking(booking(shop.id, "b3", "2026-11-12T03:00:00Z", { staffId: "haru" }));
  await store.saveBooking(booking(shop.id, "b4", "2026-11-13T01:00:00Z", { status: "cancelled" }));
  await store.saveBooking(booking(shop.id, "old", "2026-10-01T01:00:00Z"));

  await syncStaffCalendars(store, shop, google.gateway, { now, origin: "https://app.example" });
  assert.equal(google.calendars.size, 1);
  const [calendarId, calendar] = [...google.calendars.entries()][0];
  assert.equal(calendar.owner, email);
  assert.deepEqual([...calendar.events.keys()].sort(), [mirrorEventId("b1"), mirrorEventId("b2")].sort());
  const first = calendar.events.get(mirrorEventId("b1"))!;
  assert.match(first.summary, /^Hanako · /);
  assert.ok(first.description.startsWith("Short nails, please"));
  assert.ok(first.description.includes(`https://app.example/?shop=${shop.id}&tab=bookings`));
  // Contact details never leave gemihub.
  assert.ok(!JSON.stringify([...calendar.events.values()]).includes("+8190"));
  assert.ok(!JSON.stringify([...calendar.events.values()]).includes("guest@example.com"));

  // Nothing changed: no calls to Google.
  const before = google.calls.length;
  await syncStaffCalendars(store, shop, google.gateway, { now: new Date(now.getTime() + 60000), origin: "https://app.example" });
  assert.equal(google.calls.length, before);

  // A cancellation removes the event; a new booking adds one; the calendar is reused.
  await store.saveBooking(booking(shop.id, "b2", "2026-11-12T01:00:00Z", { status: "cancelled" }));
  await store.saveBooking(booking(shop.id, "b5", "2026-11-14T01:00:00Z"));
  await syncStaffCalendars(store, shop, google.gateway, { now });
  assert.equal(google.calendars.size, 1);
  assert.deepEqual([...google.calendars.get(calendarId)!.events.keys()].sort(), [mirrorEventId("b1"), mirrorEventId("b5")].sort());

  // A calendar the staff member deleted is created again on the periodic re-read.
  google.calendars.delete(calendarId);
  await syncStaffCalendars(store, shop, google.gateway, { now: new Date(now.getTime() + 7 * 3600000) });
  assert.equal(google.calendars.size, 1);
  assert.equal([...google.calendars.values()][0].events.size, 2);
});

test("a refused grant waits for reconnection, transient errors retry, and leaving deletes the calendar", async t => {
  const { store, shop, email } = await shopWithStaff();
  t.after(() => store.close());
  const google = fakeGoogle();
  const now = new Date("2026-11-10T00:00:00Z");
  await store.saveBooking(booking(shop.id, "b1", "2026-11-11T01:00:00Z"));
  const errors: unknown[] = [];

  google.setDeny(email);
  await syncStaffCalendars(store, shop, google.gateway, { now, report: error => errors.push(error) });
  assert.equal(google.calendars.size, 0);
  assert.equal(errors.length, 0);
  google.setDeny(undefined);
  const calls = google.calls.length;
  await syncStaffCalendars(store, shop, google.gateway, { now });
  assert.equal(google.calls.length, calls, "no retry with the same token");
  await store.put("calendar", `${shop.id}:${email}`, { shopId: shop.id, email, staffId: "aoi", refreshToken: "token-2" } satisfies CalendarConnection);
  await syncStaffCalendars(store, shop, google.gateway, { now });
  assert.equal(google.calendars.size, 1);

  google.setFail(true);
  await store.saveBooking(booking(shop.id, "b2", "2026-11-12T01:00:00Z"));
  await syncStaffCalendars(store, shop, google.gateway, { now, report: error => errors.push(error) });
  assert.equal(errors.length, 1);
  google.setFail(false);
  await syncStaffCalendars(store, shop, google.gateway, { now });
  assert.equal([...google.calendars.values()][0].events.size, 2);

  await removeStaffCalendar(store, shop, email, google.gateway);
  assert.equal(google.calendars.size, 0);
  assert.equal(await store.get("calendarMirror", `${shop.id}:${email}`), undefined);
});

test("a member removed without the explicit hook still has the calendar deleted by the scheduled sync", async t => {
  const { store, shop, email } = await shopWithStaff();
  t.after(() => store.close());
  const google = fakeGoogle();
  const now = new Date("2026-11-10T00:00:00Z");
  await syncStaffCalendars(store, shop, google.gateway, { now });
  assert.equal(google.calendars.size, 1);
  await store.put("member", `${shop.id}:${email}`, { shopId: shop.id, email, accepted: false, status: "revoked" });
  await syncStaffCalendars(store, shop, google.gateway, { now });
  assert.equal(google.calendars.size, 0);
  assert.equal(await store.get("calendarMirror", `${shop.id}:${email}`), undefined);
});

test("judge shops never get staff calendars", async t => {
  const { store, shop } = await shopWithStaff();
  t.after(() => store.close());
  const google = fakeGoogle();
  await syncStaffCalendars(store, { ...shop, judge: { createdAt: new Date().toISOString() } }, google.gateway, { now: new Date() });
  assert.equal(google.calendars.size, 0);
});
