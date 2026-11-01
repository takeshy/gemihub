import { test } from "node:test";
import assert from "node:assert/strict";
import { sample, slots, shopSchema, type Booking } from "../server/domain.ts";
const now = new Date("2030-01-06T00:00:00Z"); // Sunday, 09:00 JST
const make = () => structuredClone(sample);
test("JST opening times, regular closures, holidays, duration and staff schedules", () => {
  const c = make();
  c.hours.holidays = ["2030-01-09"];
  assert.equal(slots(c, [], "2030-01-08", "simple", "aoi", now).length, 0); // Tuesday
  assert.equal(slots(c, [], "2030-01-09", "simple", "aoi", now).length, 0);
  const ts = slots(c, [], "2030-01-07", "design", "aoi", now);
  assert.equal(ts[0].start, "2030-01-07T01:00:00.000Z");
  assert.equal(ts.at(-1)!.end, "2030-01-07T09:00:00.000Z");
  c.staff[0].weekdays = [0];
  assert.equal(slots(c, [], "2030-01-07", "simple", "aoi", now).length, 0);
});
test("lead time, same-day policy, future limits, and invalid calendar dates", () => {
  const c = make();
  c.rules.leadMinutes = 120;
  assert.equal(
    slots(c, [], "2030-01-06", "simple", "aoi", now)[0].start,
    "2030-01-06T02:00:00.000Z",
  );
  c.rules.sameDay = false;
  assert.equal(slots(c, [], "2030-01-06", "simple", "aoi", now).length, 0);
  assert.equal(slots(c, [], "2030-03-01", "simple", "aoi", now).length, 0);
  assert.equal(slots(c, [], "2030-02-30", "simple", "aoi", now).length, 0);
});
test("OR availability assigns an actually free eligible staff member and soft deletions free slots", () => {
  const c = make();
  const b: Booking = {
    id: "1",
    shopId: "shop",
    customer: "a@example.com",
    name: "A",
    menuId: "simple",
    price: 5500, message: "",
    staffId: "aoi",
    start: "2030-01-07T01:00:00.000Z",
    end: "2030-01-07T02:00:00.000Z",
    status: "active",
    createdAt: now.toISOString(),
  };
  assert.equal(
    slots(c, [b], "2030-01-07", "simple", undefined, now)[0].staffId,
    "haru",
  );
  const both = [b, { ...b, id: "2", staffId: "haru" }];
  assert.equal(
    slots(c, both, "2030-01-07", "simple", undefined, now)[0].start,
    "2030-01-07T02:00:00.000Z",
  );
  both[0].status = "cancelled";
  assert.equal(
    slots(c, both, "2030-01-07", "simple", undefined, now)[0].staffId,
    "aoi",
  );
  assert.ok(slots(c, [], "2030-01-07", "simple", undefined, now).length > 0);
});
test("schema rejects duplicate IDs, nonexistent references and impossible hours", () => {
  const c = make();
  c.staff[0].menuIds = ["missing"];
  assert.equal(shopSchema.safeParse(c).success, false);
  c.staff[0].menuIds = ["simple"];
  c.menus.push(c.menus[0]);
  assert.equal(shopSchema.safeParse(c).success, false);
  const c2 = make();
  c2.hours.end = "09:00";
  assert.equal(shopSchema.safeParse(c2).success, false);
});

test("customer choice honors a named staff and allocates any available staff only when unspecified", () => {
  const c = make();
  const first = slots(c, [], "2030-01-07", "simple", undefined, now)[0];
  const b: Booking = { ...first, id: "busy", shopId: "shop", customer: "", name: "", menuId: "simple", price: 5500, message: "", status: "active", createdAt: now.toISOString() };
  assert.equal(slots(c, [b], "2030-01-07", "simple", undefined, now)[0].staffId, "haru");
  assert.equal(slots(c, [b], "2030-01-07", "simple", "", now)[0].staffId, "haru");
  assert.equal(slots(c, [b], "2030-01-07", "simple", "haru", now)[0].start, first.start);
  assert.ok(!slots(c, [b], "2030-01-07", "simple", "aoi", now).some(s => s.start === first.start));
  assert.deepEqual(slots(c, [], "2030-01-07", "simple", "missing", now), []);
  c.staff[1].menuIds = ["design"];
  assert.deepEqual(slots(c, [], "2030-01-07", "simple", "haru", now), []);
});
