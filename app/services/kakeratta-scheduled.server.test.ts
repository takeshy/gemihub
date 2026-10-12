import assert from "node:assert/strict";
import test from "node:test";
import type { HubworkAccount } from "~/types/hubwork";
import { eligibleKakerattaAccount } from "./kakeratta-scheduled.server";
import { canReadKakerattaFile } from "./kakeratta-drive.server";
import { SETTINGS_FILE_NAME, ENCRYPTED_AUTH_FILE_NAME, SYNC_META_FILE_NAME } from "./sync-diff";

test("all active Premium plans can poll closed; opt-out and canceled accounts cannot", () => {
  const base = { plan: "lite", accountStatus: "enabled", billingStatus: "active", rootFolderId: "root", kakerattaEnabled: true } as HubworkAccount;
  for (const plan of ["lite", "pro", "business", "granted"] as const) assert.equal(eligibleKakerattaAccount({ ...base, plan }), true);
  assert.equal(eligibleKakerattaAccount({ ...base, kakerattaEnabled: false }), false);
  assert.equal(eligibleKakerattaAccount({ ...base, billingStatus: "canceled" }), false);
  assert.equal(eligibleKakerattaAccount({ ...base, accountStatus: "disabled" }), false);
  assert.equal(eligibleKakerattaAccount({ ...base, rootFolderId: "" }), false);
});

test("file research excludes connection credentials and the configured Secrets folder", () => {
  for (const name of [SETTINGS_FILE_NAME, ENCRYPTED_AUTH_FILE_NAME, SYNC_META_FILE_NAME, "Secrets", "Secrets/api.md"]) assert.equal(canReadKakerattaFile(name, "Secrets"), false);
  assert.equal(canReadKakerattaFile("notes/today.md", "Secrets"), true);
  assert.equal(canReadKakerattaFile("Secrets-old/note.md", "Secrets"), true);
});
