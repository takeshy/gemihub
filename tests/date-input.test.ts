import assert from "node:assert/strict";
import { test } from "node:test";
import { displayDateInput, parseDateInput } from "../src/date-input";

test("date inputs show year/month/day and preserve ISO values without time zone conversion", () => {
  assert.equal(displayDateInput("2026-11-01"), "2026/11/01");
  assert.equal(parseDateInput("2026/11/01"), "2026-11-01");
  assert.equal(parseDateInput("2026/1/2"), "2026-01-02");
  assert.equal(parseDateInput("2026-11-01"), "2026-11-01");
  assert.equal(displayDateInput("2026-11-01T09:30"), "2026/11/01 09:30");
  assert.equal(parseDateInput("2026/11/01 09:30", true), "2026-11-01T09:30");
});

test("date inputs reject invalid calendar dates and times", () => {
  for (const text of ["11/01/2026", "2026/02/29", "2026/04/31", "2026/13/01", "2026/00/01", "0000/01/01", "2026/11/"]) assert.equal(parseDateInput(text), undefined, text);
  assert.equal(parseDateInput("2028/02/29"), "2028-02-29");
  assert.equal(parseDateInput("2100/02/29"), undefined);
  assert.equal(parseDateInput("2026/11/01 24:00", true), undefined);
  assert.equal(parseDateInput("2026/11/01 09:60", true), undefined);
});
