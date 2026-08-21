import assert from "node:assert/strict";
import test from "node:test";
import type { HubworkAccount } from "./hubwork";
import {
  hasBusinessFeatures,
  hasPaidFeatures,
  isActivePremiumAccount,
  isHubworkFeatureAvailable,
} from "./hubwork";

function account(
  billingStatus: HubworkAccount["billingStatus"],
  accountStatus: HubworkAccount["accountStatus"] = "enabled",
): HubworkAccount {
  return {
    billingStatus,
    accountStatus,
    plan: "business",
  } as HubworkAccount;
}

test("past_due remains a paid-feature grace period", () => {
  const value = account("past_due");
  assert.equal(isHubworkFeatureAvailable(value), true);
  assert.equal(isActivePremiumAccount(value), true);
  assert.equal(hasPaidFeatures(value), true);
  assert.equal(hasBusinessFeatures(value), true);
});

test("canceled and administratively disabled accounts have no paid access", () => {
  const canceled = account("canceled");
  assert.equal(isHubworkFeatureAvailable(canceled), false);
  assert.equal(isActivePremiumAccount(canceled), false);
  assert.equal(hasPaidFeatures(canceled), false);
  assert.equal(hasBusinessFeatures(canceled), false);

  const disabled = account("active", "disabled");
  assert.equal(isHubworkFeatureAvailable(disabled), false);
  assert.equal(isActivePremiumAccount(disabled), false);
});
