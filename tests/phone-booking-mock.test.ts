import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMockClient } from "../src/stories/mock.ts";
import type { Workspace } from "../src/App.tsx";
import type { Booking } from "../server/domain.ts";
import { phoneCustomerSchema, type CustomerSummary } from "../server/customers.ts";

const base = "/api/shops/story-shop";
const now = Date.parse("2026-11-06T01:00:00Z");
type Slots = { slots: { start: string; end: string; staffId: string }[] };
const caller = () => ({ requestId: randomUUID(), name: "Hanako", phone: "０３－１２３４－５６７８" });

test("phone validation counts normalized digits rather than punctuation", () => {
  for (const phone of ["------", "((()))", "+ (12) 345", "１２３－－－"])
    assert.equal(phoneCustomerSchema.safeParse({ name: "Caller", phone }).success, false, phone);
  for (const phone of ["03-1234-5678", "+1 (212) 555-1234", "123456"])
    assert.equal(phoneCustomerSchema.safeParse({ name: "Caller", phone }).success, true, phone);
  assert.equal(phoneCustomerSchema.parse(caller()).phone, "03-1234-5678");
});

test("Storybook phone bookings preserve add-ons, duration and total, including retries", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const api = createMockClient("manage-addons");
  const { slots } = await api<Slots>(`${base}/bookings/phone-slots?menu=simple&option=other-off`);
  assert.ok(slots.length);
  const input = { ...caller(), menuId: "simple", optionIds: ["other-off"], start: slots[0].start, expectedPrice: 6000 };
  await assert.rejects(api(`${base}/bookings/phone`, { ...input, expectedPrice: 5500 }));
  const { booking } = await api<{ booking: Booking }>(`${base}/bookings/phone`, input);
  assert.equal(booking.price, 6000);
  assert.equal(Date.parse(booking.end) - Date.parse(booking.start), 95 * 60000);
  assert.deepEqual(booking.optionIds, ["other-off"]);
  assert.deepEqual(booking.items?.map(item => item.menuId), ["simple", "other-off"]);
  assert.equal(booking.phone, "03-1234-5678");
  assert.equal(booking.payment, undefined);
  assert.deepEqual((await api<{ booking: Booking }>(`${base}/bookings/phone`, input)).booking, booking);
  const remaining = await api<Slots>(`${base}/bookings/phone-slots?menu=simple&option=other-off`);
  assert.ok(!remaining.slots.some(slot => slot.start === booking.start));
});

test("Storybook phone bookings use the requested staff and reject invalid menu combinations", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const api = createMockClient("bookings");
  const { slots } = await api<Slots>(`${base}/bookings/phone-slots?menu=simple&staff=haru`);
  assert.ok(slots.length);
  const input = { ...caller(), menuId: "simple", staffId: "haru", start: slots[0].start };
  await assert.rejects(api(`${base}/bookings/phone`, { ...input, optionIds: ["missing"] }));
  const { booking } = await api<{ booking: Booking }>(`${base}/bookings/phone`, input);
  assert.equal(booking.staffId, "haru");
});

test("Storybook cash replacement cancels the holder, raises the refund and registers a separate cash booking", async t => {
  // Owner transfer fixtures start 18 hours ahead: midnight puts the listed slot on the same day.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-05T15:00:00Z") });
  const api = createMockClient("owner-transfer-listed");
  const workspace = () => api<{ shops: Workspace[] }>("/api/workspace");
  const shop = (await workspace()).shops[0], listing = shop.transferListings![0], held = shop.bookings[0];
  const route = `${base}/transfers/${listing.id}/phone`, input = { ...caller(), expectedPrice: listing.price };
  await assert.rejects(api(route, { ...input, phone: "------" }));
  await assert.rejects(api(route, { ...input, expectedPrice: listing.price + 1 }));
  const { booking } = await api<{ booking: Booking }>(route, input);
  assert.equal(booking.customer, "tel:+81312345678");
  assert.equal(booking.price, listing.price);
  assert.equal(booking.payment, undefined);
  assert.deepEqual([booking.start, booking.end, booking.staffId, booking.menuId], [held.start, held.end, held.staffId, held.menuId]);
  assert.notEqual(booking.id, held.id);
  assert.deepEqual((await api<{ booking: Booking }>(route, input)).booking, booking);
  await assert.rejects(api(route, { ...input, requestId: randomUUID() }));
  const updated = (await workspace()).shops[0], original = updated.bookings.find(item => item.id === held.id)!;
  assert.equal(original.status, "cancelled");
  assert.equal(original.customer, held.customer);
  assert.equal(original.payment!.cancellation!.amount, listing.price);
  assert.equal(original.payment!.cancellation!.percent, Math.floor(listing.price * 100 / held.payment!.amount));
  assert.equal(original.payment!.cancellation!.status, "completed");
  assert.ok(listing.price > listing.unsold);
  assert.equal(updated.bookings.length, 2);
  assert.deepEqual(updated.transferListings, []);
  const customers = await api<CustomerSummary[]>(`${base}/customers`);
  assert.equal(customers.find(item => item.email === booking.customer)?.phone, "03-1234-5678");
});

test("Storybook cash replacement refuses later dates and expired listings", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const api = createMockClient("owner-transfer-listed");
  const shop = (await api<{ shops: Workspace[] }>("/api/workspace")).shops[0], listing = shop.transferListings![0];
  const route = `${base}/transfers/${listing.id}/phone`, input = { ...caller(), expectedPrice: listing.price };
  await assert.rejects(api(route, input), /当日/);
  t.mock.timers.setTime(Date.parse(listing.deadline));
  await assert.rejects(api(route, input), /受付は終了/);
  const updated = (await api<{ shops: Workspace[] }>("/api/workspace")).shops[0];
  assert.equal(updated.bookings.length, 1);
  assert.equal(updated.bookings[0].status, "active");
});
