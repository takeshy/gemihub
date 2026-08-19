import assert from "node:assert/strict";
import test from "node:test";
import {
  nextBudgetPeriod,
  previousBudgetPeriod,
  resolveBudgetPeriod,
  topUpExpiryDate,
} from "./ai-budget.server";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

test("no anchor keeps calendar months", () => {
  const period = resolveBudgetPeriod(null, at("2026-08-19"));
  assert.equal(period.key, "2026-08");
  assert.equal(day(period.startMs), "2026-08-01");
  assert.equal(day(period.endMs), "2026-09-01");
  assert.equal(previousBudgetPeriod(period).key, "2026-07");
  assert.equal(nextBudgetPeriod(period).key, "2026-09");
});

test("an anchor makes the window follow the billing cycle", () => {
  const period = resolveBudgetPeriod(28, at("2026-08-30"));
  assert.equal(period.key, "2026-08-28");
  assert.equal(day(period.endMs), "2026-09-28");
});

test("before the anchor day the window started last month", () => {
  const period = resolveBudgetPeriod(28, at("2026-09-10"));
  assert.equal(period.key, "2026-08-28");
  assert.equal(day(period.endMs), "2026-09-28");
});

test("a day-31 anchor clamps to the last day of shorter months", () => {
  const february = resolveBudgetPeriod(31, at("2026-02-15"));
  assert.equal(february.key, "2026-01-31");
  assert.equal(day(february.endMs), "2026-02-28");

  const march = resolveBudgetPeriod(31, at("2026-03-05"));
  assert.equal(march.key, "2026-02-28");
  assert.equal(day(march.endMs), "2026-03-31");
});

test("windows chain across a year boundary", () => {
  const period = resolveBudgetPeriod(15, at("2026-01-20"));
  assert.equal(period.key, "2026-01-15");
  assert.equal(previousBudgetPeriod(period).key, "2025-12-15");
  assert.equal(nextBudgetPeriod(period).key, "2026-02-15");

  const december = resolveBudgetPeriod(15, at("2025-12-20"));
  assert.equal(nextBudgetPeriod(december).key, "2026-01-15");
  assert.equal(previousBudgetPeriod(december).key, "2025-11-15");
});

test("calendar windows chain across a year boundary", () => {
  const january = resolveBudgetPeriod(null, at("2026-01-10"));
  assert.equal(previousBudgetPeriod(january).key, "2025-12");
  const december = resolveBudgetPeriod(null, at("2025-12-10"));
  assert.equal(nextBudgetPeriod(december).key, "2026-01");
});

test("top-ups stay usable until the end of the following window", () => {
  // Billing cycle: bought during 08-28 → 09-28, usable until 10-27.
  assert.equal(topUpExpiryDate(resolveBudgetPeriod(28, at("2026-09-10"))), "2026-10-27");
  // Calendar: bought in August → usable through the end of September.
  assert.equal(topUpExpiryDate(resolveBudgetPeriod(null, at("2026-08-19"))), "2026-09-30");
});

test("a period contains the instant it was resolved for", () => {
  for (const anchor of [null, 1, 15, 28, 31]) {
    for (const iso of ["2026-01-01", "2026-02-28", "2026-03-31", "2026-12-31"]) {
      const now = at(iso);
      const period = resolveBudgetPeriod(anchor, now);
      assert.ok(period.startMs <= now.getTime(), `${anchor} ${iso} start`);
      assert.ok(period.endMs > now.getTime(), `${anchor} ${iso} end`);
    }
  }
});
