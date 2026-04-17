import assert from "node:assert/strict";
import test from "node:test";
import { rewriteHubworkSpreadsheetRefs } from "./hubwork-settings-rewriter.ts";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "../types/settings.ts";

function baseSettings(overrides: Partial<UserSettings["hubwork"]> = {}): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    hubwork: {
      plan: "pro",
      spreadsheets: [{ id: "old-id", label: "webpage_builder" }],
      accounts: {
        accounts: {
          identity: { spreadsheetId: "old-id", sheet: "accounts", emailColumn: "email" },
          data: {
            profile: { spreadsheetId: "old-id", sheet: "profile", matchBy: "email", fields: ["name"] },
          },
        },
      },
      ...overrides,
    },
  };
}

test("rewriteHubworkSpreadsheetRefs updates spreadsheet entry, identity and data references", () => {
  const settings = baseSettings();
  const result = rewriteHubworkSpreadsheetRefs(settings, new Set(["old-id"]), "new-id");
  assert.ok(result, "expected rewrite to occur");
  assert.equal(result.hubwork?.spreadsheets?.[0]?.id, "new-id");
  assert.equal(result.hubwork?.spreadsheets?.[0]?.label, "webpage_builder");
  assert.equal(result.hubwork?.accounts?.accounts?.identity.spreadsheetId, "new-id");
  assert.equal(result.hubwork?.accounts?.accounts?.data?.profile?.spreadsheetId, "new-id");
});

test("rewriteHubworkSpreadsheetRefs returns null when nothing references a discarded id", () => {
  const settings = baseSettings({
    spreadsheets: [{ id: "other-id", label: "other" }],
    accounts: {
      accounts: {
        identity: { spreadsheetId: "other-id", sheet: "accounts", emailColumn: "email" },
      },
    },
  });
  const result = rewriteHubworkSpreadsheetRefs(settings, new Set(["old-id"]), "new-id");
  assert.equal(result, null);
});

test("rewriteHubworkSpreadsheetRefs preserves unrelated spreadsheets and accounts", () => {
  const settings = baseSettings({
    spreadsheets: [
      { id: "old-id", label: "webpage_builder" },
      { id: "unrelated", label: "other" },
    ],
    accounts: {
      accounts: {
        identity: { spreadsheetId: "old-id", sheet: "accounts", emailColumn: "email" },
      },
      staff: {
        identity: { spreadsheetId: "unrelated", sheet: "staff", emailColumn: "email" },
      },
    },
  });
  const result = rewriteHubworkSpreadsheetRefs(settings, new Set(["old-id"]), "new-id");
  assert.ok(result);
  assert.deepEqual(result.hubwork?.spreadsheets, [
    { id: "new-id", label: "webpage_builder" },
    { id: "unrelated", label: "other" },
  ]);
  assert.equal(result.hubwork?.accounts?.accounts?.identity.spreadsheetId, "new-id");
  assert.equal(result.hubwork?.accounts?.staff?.identity.spreadsheetId, "unrelated");
});

test("rewriteHubworkSpreadsheetRefs returns null when hubwork block is absent", () => {
  const settings: UserSettings = { ...DEFAULT_USER_SETTINGS };
  const result = rewriteHubworkSpreadsheetRefs(settings, new Set(["old-id"]), "new-id");
  assert.equal(result, null);
});
