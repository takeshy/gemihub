import assert from "node:assert/strict";
import test from "node:test";
import { executeIsolatedJS } from "./isolated-vm-executor.server.ts";

// The `utils` helper namespace is the sole GemiHub-provided surface inside the
// script sandbox. These tests lock in the contract the skill docs and the
// client-side sandbox (sandbox-executor.ts) agree on: `utils.randomUUID()`
// exists, `crypto` does NOT, and the ECMAScript standard library works.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("utils.randomUUID returns a valid RFC 4122 v4 UUID", async () => {
  const result = await executeIsolatedJS("return utils.randomUUID();");
  assert.match(result, UUID_V4);
});

test("utils.randomUUID returns unique values across calls in one script", async () => {
  const result = await executeIsolatedJS(`
    const a = utils.randomUUID();
    const b = utils.randomUUID();
    return JSON.stringify({ a, b, equal: a === b });
  `);
  const parsed = JSON.parse(result);
  assert.match(parsed.a, UUID_V4);
  assert.match(parsed.b, UUID_V4);
  assert.equal(parsed.equal, false);
});

test("crypto is not defined — using it should fail", async () => {
  // typeof against an undeclared identifier is the one case that does not
  // throw, so this is the canonical way to detect absence from the guest.
  const typeofResult = await executeIsolatedJS("return typeof crypto;");
  assert.equal(typeofResult, "undefined");

  // Touching crypto.anything should throw, matching the docs promise.
  await assert.rejects(
    () => executeIsolatedJS("return crypto.randomUUID();"),
    /crypto is not defined/,
  );
});

test("utils is frozen — reassignment inside the sandbox is ignored", async () => {
  // Sloppy mode (new Function / compileScript default) silently ignores
  // assignment to a frozen property, so the original function still runs.
  const result = await executeIsolatedJS(`
    utils.randomUUID = () => "pwned";
    return utils.randomUUID();
  `);
  assert.match(result, UUID_V4);
  assert.notEqual(result, "pwned");
});

test("input variable is still available alongside utils", async () => {
  const result = await executeIsolatedJS("return input + ':' + utils.randomUUID().length;", "hi");
  assert.equal(result, "hi:36");
});

test("ECMAScript standard library is fully available (Date / Intl / JSON / Math)", async () => {
  const result = await executeIsolatedJS(`
    const d = new Date("2026-01-15T10:30:00Z");
    return JSON.stringify({
      iso: d.toISOString(),
      locale: d.toLocaleString("en-US", { dateStyle: "long", timeZone: "UTC" }),
      hasIntl: typeof Intl.DateTimeFormat,
      hasJSON: typeof JSON.stringify,
      hasMath: typeof Math.floor,
    });
  `);
  const parsed = JSON.parse(result);
  assert.equal(parsed.iso, "2026-01-15T10:30:00.000Z");
  assert.ok(parsed.locale.includes("2026"));
  assert.equal(parsed.hasIntl, "function");
  assert.equal(parsed.hasJSON, "function");
  assert.equal(parsed.hasMath, "function");
});

test("fetch / setTimeout / process are not defined in the sandbox", async () => {
  const result = await executeIsolatedJS(`
    return JSON.stringify({
      fetch: typeof fetch,
      setTimeout: typeof setTimeout,
      process: typeof process,
      require: typeof require,
    });
  `);
  const parsed = JSON.parse(result);
  assert.equal(parsed.fetch, "undefined");
  assert.equal(parsed.setTimeout, "undefined");
  assert.equal(parsed.process, "undefined");
  assert.equal(parsed.require, "undefined");
});

test("infinite loop is killed by the timeout", async () => {
  await assert.rejects(
    () => executeIsolatedJS("while (true) {}", undefined, 200),
    /Script execution timed out/,
  );
});
