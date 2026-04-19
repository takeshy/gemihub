import assert from "node:assert/strict";
import test from "node:test";
import { extractAuthProfileFromRows } from "./hubwork-page-renderer.server.ts";
import { replaceVariables } from "../engine/handlers/utils.ts";
import type { ExecutionContext } from "../engine/types.ts";

// Pure-logic tests for the auth.* profile extraction — the Sheets API call
// is tested via integration; this file nails down the row-matching and
// column-exposure rules so they don't silently drift.

test("extracts non-email columns from the matching row", () => {
  const rows = [
    ["email", "name", "created_at", "logined_at"],
    ["alice@example.com", "Alice", "2026-01-01T00:00:00Z", "2026-04-10T12:00:00Z"],
    ["bob@example.com", "Bob", "2026-02-01T00:00:00Z", "2026-04-11T12:00:00Z"],
  ];
  const profile = extractAuthProfileFromRows(rows, "email", "alice@example.com");
  assert.deepEqual(profile, {
    name: "Alice",
    created_at: "2026-01-01T00:00:00Z",
    logined_at: "2026-04-10T12:00:00Z",
  });
});

test("normalizes email whitespace / case so sheet formatting mismatches still match", () => {
  const rows = [
    ["email", "name"],
    ["  Alice@Example.COM  ", "Alice"],
  ];
  const profile = extractAuthProfileFromRows(rows, "email", "alice@example.com");
  assert.equal(profile.name, "Alice");
});

test("returns empty object when no row matches", () => {
  const rows = [
    ["email", "name"],
    ["alice@example.com", "Alice"],
  ];
  assert.deepEqual(
    extractAuthProfileFromRows(rows, "email", "charlie@example.com"),
    {},
  );
});

test("returns empty object on missing email column header", () => {
  const rows = [
    ["id", "name"],
    ["1", "Alice"],
  ];
  assert.deepEqual(extractAuthProfileFromRows(rows, "email", "alice@example.com"), {});
});

test("returns empty object on header-only sheet", () => {
  const rows = [["email", "name"]];
  assert.deepEqual(extractAuthProfileFromRows(rows, "email", "alice@example.com"), {});
});

test("returns empty object on empty sheet", () => {
  assert.deepEqual(extractAuthProfileFromRows([], "email", "alice@example.com"), {});
});

test("skips reserved column names that would shadow auth.email / auth.type", () => {
  // A column literally named `type` or `email` on the identity sheet would
  // collide with the router-guaranteed vars; guard against silent override.
  const rows = [
    ["email", "type", "name"],
    ["alice@example.com", "malicious", "Alice"],
  ];
  const profile = extractAuthProfileFromRows(rows, "email", "alice@example.com");
  assert.deepEqual(profile, { name: "Alice" });
  assert.ok(!("type" in profile));
  assert.ok(!("email" in profile));
});

test("treats blank cells as empty strings (not undefined)", () => {
  const rows = [
    ["email", "name", "company"],
    ["alice@example.com", "Alice"],  // company cell missing from the array
  ];
  const profile = extractAuthProfileFromRows(rows, "email", "alice@example.com");
  assert.equal(profile.name, "Alice");
  assert.equal(profile.company, "");
});

test("ignores unnamed / empty header columns", () => {
  const rows = [
    ["email", "", "name"],
    ["alice@example.com", "junk", "Alice"],
  ];
  const profile = extractAuthProfileFromRows(rows, "email", "alice@example.com");
  assert.deepEqual(profile, { name: "Alice" });
});

// Integration: verify the router's dual-view layout (flat `auth.<key>` keys +
// a combined `auth` JSON blob) round-trips through the template resolver.
// Especially important because `{{auth.profile.name}}` has to go via the
// resolver's fallback path — first-dot split to `auth`, parse, drill.

function makeAuthVariables(combined: Record<string, unknown>): Map<string, string | number> {
  // Mirror the exact layout hubwork.internal.api.$.tsx writes so this test
  // breaks if that layout drifts.
  const variables = new Map<string, string | number>();
  for (const [key, value] of Object.entries(combined)) {
    variables.set(`auth.${key}`, typeof value === "string" ? value : JSON.stringify(value));
  }
  variables.set("auth", JSON.stringify(combined));
  return variables;
}

function makeContext(variables: Map<string, string | number>): ExecutionContext {
  return {
    variables,
    currentNodeId: null,
    historyLogger: null,
    saveStatusByNode: new Map(),
    abortSignal: undefined,
  } as unknown as ExecutionContext;
}

test("resolver: flat auth.<key> lookup for identity columns", () => {
  const ctx = makeContext(
    makeAuthVariables({
      type: "accounts",
      email: "alice@example.com",
      name: "Alice",
      created_at: "2026-01-01T00:00:00Z",
    }),
  );
  assert.equal(replaceVariables("{{auth.email}}", ctx), "alice@example.com");
  assert.equal(replaceVariables("{{auth.type}}", ctx), "accounts");
  assert.equal(replaceVariables("{{auth.name}}", ctx), "Alice");
  assert.equal(replaceVariables("{{auth.created_at}}", ctx), "2026-01-01T00:00:00Z");
});

test("resolver: deep dot access into data-source JSON via auth fallback", () => {
  const ctx = makeContext(
    makeAuthVariables({
      type: "accounts",
      email: "alice@example.com",
      profile: { name: "Alice", company: "Example Corp" },
      orders: [{ id: "o1", total: 100 }],
    }),
  );
  // `auth.profile` on its own returns the JSON blob
  assert.equal(
    replaceVariables("{{auth.profile}}", ctx),
    '{"name":"Alice","company":"Example Corp"}',
  );
  // Deep access drills through the resolver's first-dot split
  assert.equal(replaceVariables("{{auth.profile.name}}", ctx), "Alice");
  assert.equal(replaceVariables("{{auth.profile.company}}", ctx), "Example Corp");
  // Arrays reachable via index
  assert.equal(replaceVariables("{{auth.orders[0].id}}", ctx), "o1");
});

test("resolver: unknown auth.<column> leaves the placeholder literal (so typos are visible)", () => {
  const ctx = makeContext(
    makeAuthVariables({ type: "accounts", email: "alice@example.com", name: "Alice" }),
  );
  // `auth.foo` with no flat key AND no matching nested field on the combined
  // object → template resolver falls through and returns the original text,
  // exposing the typo in sheet rows / email bodies rather than silently
  // writing "".
  const out = replaceVariables("{{auth.firstName}}", ctx);
  assert.equal(out, "{{auth.firstName}}");
});
