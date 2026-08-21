import assert from "node:assert/strict";
import test from "node:test";
import type { HubworkAccount } from "./hubwork";
import {
  BUSINESS_CANCELLATION_RETENTION_DAYS,
  cancellationDeleteAfterIso,
  hasBusinessFeatures,
  hasPaidFeatures,
  isActivePremiumAccount,
  isHubworkFeatureAvailable,
  organizationLifecycle,
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

const DAY_MS = 86_400_000;
const CANCELED_AT = Date.UTC(2026, 7, 21);
const DELETE_AFTER = CANCELED_AT + BUSINESS_CANCELLATION_RETENTION_DAYS * DAY_MS;

function canceledAccount(): Parameters<typeof organizationLifecycle>[0] {
  return {
    billingStatus: "canceled",
    accountStatus: "disabled",
    deleteAfter: { toMillis: () => DELETE_AFTER } as never,
  };
}

test("cancellation keeps the organization readable until deleteAfter", () => {
  const account = canceledAccount();
  assert.equal(organizationLifecycle(account, CANCELED_AT), "read-only");
  assert.equal(organizationLifecycle(account, DELETE_AFTER - 1), "read-only");
});

test("the export window ends: an expired organization is no longer served", () => {
  const account = canceledAccount();
  assert.equal(organizationLifecycle(account, DELETE_AFTER), "expired");
  assert.equal(organizationLifecycle(account, DELETE_AFTER + DAY_MS), "expired");
});

test("a legacy cancellation derives deleteAfter from canceledAt", () => {
  const legacy = {
    billingStatus: "canceled",
    accountStatus: "disabled",
    canceledAt: { toMillis: () => CANCELED_AT } as never,
  } as const;
  assert.equal(organizationLifecycle(legacy, DELETE_AFTER - 1), "read-only");
  assert.equal(organizationLifecycle(legacy, DELETE_AFTER), "expired");
  assert.equal(cancellationDeleteAfterIso(legacy), new Date(DELETE_AFTER).toISOString());
});

test("a malformed cancellation without either timestamp fails closed", () => {
  const malformed = { billingStatus: "canceled", accountStatus: "disabled" } as const;
  assert.equal(organizationLifecycle(malformed, CANCELED_AT), "expired");
  assert.equal(cancellationDeleteAfterIso(malformed), undefined);
});

test("the admin master switch is its own state, with no export grace", () => {
  assert.equal(
    organizationLifecycle({ billingStatus: "active", accountStatus: "disabled" }, CANCELED_AT),
    "disabled",
  );
  assert.equal(
    organizationLifecycle({ billingStatus: "past_due", accountStatus: "enabled" }, CANCELED_AT),
    "active",
  );
});

test("cancellationDeleteAfterIso renders the window end for messages and banners", () => {
  assert.equal(cancellationDeleteAfterIso(canceledAccount()), new Date(DELETE_AFTER).toISOString());
});
