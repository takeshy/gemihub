import assert from "node:assert/strict";
import test from "node:test";
import { validateRegistrationFields } from "./hubwork-registration.server";
import type { HubworkRegisterField } from "~/types/settings";

const schema: HubworkRegisterField[] = [
  { name: "name", label: "氏名", type: "text", required: true, maxLength: 10 },
  { name: "company", label: "会社名", type: "text", required: false },
  { name: "role", label: "役職", type: "select", options: ["admin", "member"] },
];

test("accepts valid submission and trims whitespace", () => {
  const result = validateRegistrationFields(schema, {
    name: "  Alice  ",
    company: "Acme",
    role: "admin",
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(result.values, { name: "Alice", company: "Acme", role: "admin" });
  }
});

test("rejects missing required field", () => {
  const result = validateRegistrationFields(schema, { company: "Acme" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /氏名/);
});

test("rejects overflowing maxLength", () => {
  const result = validateRegistrationFields(schema, { name: "12345678901" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /氏名.*too long/);
});

test("rejects select option not in whitelist", () => {
  const result = validateRegistrationFields(schema, { name: "Alice", role: "owner" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /役職/);
});

test("rejects CRLF injection attempts", () => {
  const result = validateRegistrationFields(schema, { name: "Alice\r\nBcc: x@x" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /氏名.*invalid characters/);
});

test("skips optional fields when blank", () => {
  const result = validateRegistrationFields(schema, { name: "Alice" });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.values.name, "Alice");
    assert.equal(result.values.company, "");
    assert.equal(result.values.role, "");
  }
});

test("validates email field format", () => {
  const emailSchema: HubworkRegisterField[] = [
    { name: "alt", label: "連絡先メール", type: "email", required: true },
  ];
  const bad = validateRegistrationFields(emailSchema, { alt: "not-an-email" });
  assert.equal(bad.ok, false);

  const good = validateRegistrationFields(emailSchema, { alt: "a@b.co" });
  assert.ok(good.ok);
});
