import { test } from "node:test";
import assert from "node:assert/strict";
import { managementSummary } from "../shared/management-dashboard.ts";
import { sample, type Booking } from "../server/domain.ts";

const booking = (id: string, start: string, status: Booking["status"] = "active") => ({ id, start, status } as Booking);
test("today's bookings follow the shop's date, include cancelled records, and stay in time order", () => {
  const bookings = [booking("tomorrow", "2026-11-08T15:00:00Z"), booking("late", "2026-11-08T14:59:59Z", "cancelled"), booking("early", "2026-11-07T15:00:00Z"), booking("yesterday", "2026-11-07T14:59:59Z"), booking("invalid", "invalid")];
  const original = [...bookings];
  const summary = managementSummary(sample, bookings, [], Date.parse("2026-11-07T16:00:00Z"));
  assert.equal(summary.today, "2026-11-08");
  assert.deepEqual(summary.bookings.map(item => item.id), ["early", "late"]);
  assert.deepEqual(bookings, original);
});

test("the US daylight-saving transition covers both occurrences of the repeated hour", () => {
  const config = { ...sample, region: { country: "US" as const, timeZone: "America/New_York" } };
  const bookings = [booking("before", "2026-11-01T03:59:59Z"), booking("first-0130", "2026-11-01T05:30:00Z"), booking("second-0130", "2026-11-01T06:30:00Z"), booking("last", "2026-11-02T04:59:59Z"), booking("next", "2026-11-02T05:00:00Z")];
  const summary = managementSummary(config, bookings, [], Date.parse("2026-11-01T07:00:00Z"));
  assert.equal(summary.today, "2026-11-01");
  assert.deepEqual(summary.bookings.map(item => item.id), ["first-0130", "second-0130", "last"]);
});

test("unhandled inquiries mean new, with the same legacy status normalization as the inquiry list", () => {
  const items = [
    { id: "newer", status: "new", at: "2026-11-08T01:00:00Z" },
    { id: "older", status: "new", at: "2026-11-01T01:00:00Z" },
    ...["in_progress", "waiting", "completed", "replied", "unrecognized"].map(status => ({ id: status, status })),
  ];
  const original = [...items];
  assert.deepEqual(managementSummary(sample, [], items).inquiries.map(item => item.id), ["older", "newer"]);
  assert.deepEqual(items, original);
  assert.deepEqual(managementSummary(sample, [], []).inquiries, []);
});
