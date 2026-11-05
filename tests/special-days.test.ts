import { test } from "node:test";
import assert from "node:assert/strict";
import { sample, shopSchema, slots, closedOn, specialDaysText, ownerStaffId } from "../server/domain.ts";
import { applySettingsFacts, settingsChanges } from "../server/settings-ai.ts";
import { requestLocale } from "../server/i18n.ts";
import { updateLiveValue } from "../server/live-settings.ts";

// 2026-11-02 is a Monday (the regular closed day here), 2026-11-03 a Tuesday (Culture Day), 2026-11-06 a Friday.
const base = (staff: boolean) => shopSchema.parse({
  ...structuredClone(sample), ...(staff ? {} : { ownerBooking: true }),
  staff: staff ? sample.staff.map(person => ({ ...person, weekdays: [0, 2, 3, 4, 5, 6] })) : [],
  hours: { start: "10:00", end: "18:00", closedWeekdays: [1], holidays: [], specialDays: [] },
  rules: { ...sample.rules, leadMinutes: 0, advanceDays: 30, sameDay: true },
});
const now = new Date("2026-11-01T00:00:00+09:00");

test("a special day opens a closed weekday with its own hours, and the next day can close instead", () => {
  const config = base(false);
  assert.deepEqual(slots(config, [], "2026-11-02", "simple", undefined, now), [], "Monday is a regular closed day");
  config.hours.specialDays = [{ date: "2026-11-02", start: "11:00", end: "17:00" }];
  config.hours.holidays = ["2026-11-03"];
  const monday = slots(config, [], "2026-11-02", "simple", undefined, now);
  assert.equal(monday[0].start, "2026-11-02T02:00:00.000Z");
  assert.equal(monday.at(-1)!.end, "2026-11-02T08:00:00.000Z");
  assert.equal(monday[0].staffId, ownerStaffId);
  assert.deepEqual(slots(config, [], "2026-11-03", "simple", undefined, now), [], "the substitute day off closes");
  assert.equal(closedOn(config, "2026-11-02"), false);
  assert.equal(closedOn(config, "2026-11-03"), true);
  assert.equal(closedOn(config, "2026-11-09"), true, "other Mondays stay closed");
});

test("a special day can stay open late, and staff work its hours whatever their regular shift", () => {
  const config = base(true);
  const usual = slots(config, [], "2026-11-06", "simple", undefined, now);
  assert.ok(usual.length);
  assert.ok(Date.parse(usual.at(-1)!.end) <= Date.parse("2026-11-06T09:00:00Z"));
  config.hours.specialDays = [{ date: "2026-11-06", start: "10:00", end: "22:00" }, { date: "2026-11-02", start: "10:00", end: "18:00" }];
  const late = slots(config, [], "2026-11-06", "simple", undefined, now);
  assert.equal(late.at(-1)!.end, "2026-11-06T13:00:00.000Z");
  assert.ok(slots(config, [], "2026-11-02", "simple", undefined, now).length, "staff who do not work Mondays still take a special Monday");
  assert.equal(requestLocale.run("ja", () => specialDaysText(config)), "2026-11-02 10:00 – 18:00 / 2026-11-06 10:00 – 22:00");
});

test("special days validate duplicates, time ranges and clashes with holidays; AI suggestions keep them", () => {
  const config = base(false);
  const day = { date: "2026-11-02", start: "10:00", end: "18:00" };
  for (const hours of [
    { ...config.hours, specialDays: [day, { ...day, start: "11:00" }] },
    { ...config.hours, specialDays: [{ ...day, start: "19:00" }] },
    { ...config.hours, specialDays: [day], holidays: ["2026-11-02"] },
    { ...config.hours, specialDays: [{ ...day, date: "2026/11/02" }] },
  ]) assert.equal(shopSchema.safeParse({ ...config, hours }).success, false);
  const result = applySettingsFacts(config, "hours", { specialDays: [{ date: "2026-11-23", start: "10:00", end: "18:00" }], holidays: ["2026-11-24"] });
  assert.deepEqual(result.config.hours.specialDays, [{ date: "2026-11-23", start: "10:00", end: "18:00" }]);
  const changes = requestLocale.run("ja", () => settingsChanges(config, result.config, "hours"));
  assert.ok(changes.some(change => change.label === "特別営業日" && change.after === "2026-11-23 10:00 – 18:00"));
});

test("a special day can name who works it; only they take bookings, and removed staff drop out", () => {
  const config = base(true);
  config.hours.specialDays = [{ date: "2026-11-02", start: "10:00", end: "20:00", staffIds: ["haru"] }];
  const choices = slots(config, [], "2026-11-02", "simple", undefined, now);
  assert.ok(choices.length);
  assert.ok(choices.every(slot => slot.staffId === "haru"));
  assert.deepEqual(slots(config, [], "2026-11-02", "simple", "aoi", now), [], "aoi is off that date");
  const busy = choices.map(slot => ({ id: slot.start, shopId: "s", menuId: "simple", staffId: "haru", start: slot.start, end: slot.end, status: "active" }));
  assert.deepEqual(slots(config, busy as never, "2026-11-02", "simple", undefined, now), [], "a fully booked chosen staff member is not covered by others");
  assert.match(requestLocale.run("ja", () => specialDaysText(config)), /2026-11-02 10:00 – 20:00（出勤：はる）/);
  for (const staffIds of [[], ["nobody"]]) assert.equal(shopSchema.safeParse({ ...config, hours: { ...config.hours, specialDays: [{ ...config.hours.specialDays[0], staffIds }] } }).success, false);
  config.hours.specialDays.push({ date: "2026-11-09", start: "10:00", end: "18:00", staffIds: ["aoi", "haru"] });
  const updated = updateLiveValue(config, "staff", config.staff.filter(person => person.id !== "aoi"));
  assert.deepEqual(updated.hours.specialDays!.map(day => day.staffIds), [["haru"], ["haru"]]);
  assert.throws(() => updateLiveValue(config, "staff", config.staff.filter(person => person.id !== "haru")), /2026-11-02/, "a date left with nobody stops the save and names the date");
});
