import type { Timestamp } from "@google-cloud/firestore";

/**
 * USD charged per purchased Vertex AI budget top-up unit. Must match the
 * Stripe price behind STRIPE_PRICE_ID_VERTEX_TOPUP{,_USD} — this is the billed
 * amount, not the credited budget (see VERTEX_TOPUP_UNIT_CREDIT_USD). Lives
 * here rather than in ai-budget.server.ts because the settings UI renders it,
 * and a client import of a .server module fails the build.
 */
export const VERTEX_TOPUP_UNIT_USD = 10;

/** The same unit priced in JPY. Must match STRIPE_PRICE_ID_VERTEX_TOPUP. */
export const VERTEX_TOPUP_UNIT_JPY = 1500;

/**
 * USD actually credited per purchased top-up unit. Lower than
 * VERTEX_TOPUP_UNIT_USD (the charged amount) to absorb Stripe's processing
 * fee (~3.6% in Japan) with margin to spare.
 */
export const VERTEX_TOPUP_UNIT_CREDIT_USD = 9;

/** Unit counts a single checkout may buy. */
export const VERTEX_TOPUP_UNIT_CHOICES = [1, 2, 3, 5, 10] as const;

// --- Firestore document types ---

export type HubworkAccountPlan = "lite" | "pro" | "business" | "granted";
export type HubworkBillingStatus = "active" | "past_due" | "canceled";
export type HubworkAccountStatus = "enabled" | "disabled";
export type HubworkDomainStatus = "none" | "pending_dns" | "provisioning_cert" | "active" | "failed";
/** Billing currency for lite/pro subscriptions. Missing on legacy accounts and treated as "jpy". */
export type HubworkCurrency = "jpy" | "usd";

export interface HubworkAccount {
  id: string;
  email: string;
  encryptedRefreshToken: string;
  encryptedGeminiApiKey?: string;
  accountSlug: string;
  defaultDomain: string;
  customDomain?: string;
  rootFolderName: string;
  rootFolderId: string;
  spreadsheetId?: string;
  plan: HubworkAccountPlan;
  currency?: HubworkCurrency;
  billingStatus: HubworkBillingStatus;
  accountStatus: HubworkAccountStatus;
  domainStatus: HubworkDomainStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  /** When paid access ended. Business organization data remains readable for 30 days. */
  canceledAt?: Timestamp;
  /** End of the cancellation export window; data is eligible for deletion afterwards. */
  deleteAfter?: Timestamp;
  /** Organization provisioned by a Business subscription (owner = purchaser). */
  orgId?: string;
  /** The org's default shared project. */
  projectId?: string;
  activeScheduleRevision?: string;
  createdAt: Timestamp;
}

/** Days a canceled Business organization stays readable so members can export. */
export const BUSINESS_CANCELLATION_RETENTION_DAYS = 30;

/**
 * What an organization's data may still be used for.
 *
 * - `active` — normal operation.
 * - `read-only` — canceled, inside the export window: reads and exports only.
 * - `expired` — the export window ended; the data is queued for deletion and
 *   is no longer served. Without this state a canceled organization would sit
 *   readable forever, because `deleteAfter` alone is only a stored date.
 * - `disabled` — the admin master switch (`accountStatus`) is off. Distinct
 *   from `read-only`: there is no export grace, the account is simply closed.
 */
export type OrganizationLifecycle = "active" | "read-only" | "expired" | "disabled";

function timestampMillis(value: Timestamp | undefined): number | null {
  const candidate = value as { toMillis?: () => number } | undefined;
  return typeof candidate?.toMillis === "function" ? candidate.toMillis() : null;
}

/**
 * Resolve the lifecycle of the organization owned by this billing account.
 *
 * Cancellation wins over `accountStatus`: cancelling *sets* the account to
 * disabled, and the 30-day export window has to survive that.
 */
export function organizationLifecycle(
  account: Pick<HubworkAccount, "billingStatus" | "accountStatus" | "deleteAfter" | "canceledAt">,
  nowMs: number = Date.now(),
): OrganizationLifecycle {
  if (account.billingStatus === "canceled") {
    const storedDeleteAfterMs = timestampMillis(account.deleteAfter);
    const canceledAtMs = timestampMillis(account.canceledAt);
    const deleteAfterMs = storedDeleteAfterMs ?? (
      canceledAtMs === null
        ? null
        : canceledAtMs + BUSINESS_CANCELLATION_RETENTION_DAYS * 86_400_000
    );
    return deleteAfterMs !== null && nowMs < deleteAfterMs ? "read-only" : "expired";
  }
  return account.accountStatus === "disabled" ? "disabled" : "active";
}

/** ISO date the export window closes, for error messages and the IDE banner. */
export function cancellationDeleteAfterIso(
  account: Pick<HubworkAccount, "deleteAfter" | "canceledAt">,
): string | undefined {
  const storedDeleteAfterMs = timestampMillis(account.deleteAfter);
  const canceledAtMs = timestampMillis(account.canceledAt);
  const deleteAfterMs = storedDeleteAfterMs ?? (
    canceledAtMs === null
      ? null
      : canceledAtMs + BUSINESS_CANCELLATION_RETENTION_DAYS * 86_400_000
  );
  return deleteAfterMs === null ? undefined : new Date(deleteAfterMs).toISOString();
}

/** past_due is a payment-recovery grace period; only disabled/canceled access stops. */
export function isHubworkFeatureAvailable(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && account.billingStatus !== "canceled";
}

/** Check if account has paid features (Gmail, 5 GB uploads, etc.) — lite or above. */
export function hasPaidFeatures(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && account.billingStatus !== "canceled" && !!account.plan;
}

export function isActivePremiumAccount(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && !!account.plan && account.billingStatus !== "canceled";
}

/** Check if account has Business features (Sheets, web builder, custom domains, organization) */
export function hasBusinessFeatures(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && account.billingStatus !== "canceled" && (account.plan === "business" || account.plan === "granted");
}

/**
 * Check if account has Pro features or better (scheduled workflows, static
 * page hosting on the built-in subdomain). Business/granted accounts are
 * included — Pro is a strict subset of their entitlements.
 */
export function hasProFeatures(account: HubworkAccount): boolean {
  return (
    account.accountStatus === "enabled" &&
    account.billingStatus !== "canceled" &&
    (account.plan === "pro" || account.plan === "business" || account.plan === "granted")
  );
}

export type HubworkConcurrencyPolicy = "allow" | "forbid";
export type HubworkMissedRunPolicy = "skip" | "run-once";

/** scheduleIndex — desired config (immutable between rebuilds) */
export interface HubworkScheduleDoc {
  workflowPath: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  variables?: Record<string, string>;
  retry: number;
  timeoutSec: number;
  concurrencyPolicy: HubworkConcurrencyPolicy;
  missedRunPolicy: HubworkMissedRunPolicy;
  updatedAt: Timestamp;
  sourceVersion: string;
}

/** scheduleRuntime — mutable execution state */
export interface HubworkScheduleRuntime {
  retryCount: number;
  lockedUntil?: Timestamp;
  lastRunAt?: Timestamp;
  lastSuccessAt?: Timestamp;
  lastError?: string;
  updatedAt: Timestamp;
}

export interface MagicLinkToken {
  accountId: string;
  email: string;
  expiresAt: Timestamp;
  used: boolean;
}

// --- Resolved account with decrypted tokens (not stored in Firestore) ---

export interface ResolvedAccountTokens {
  accessToken: string;
  expiryTime: number;
  rootFolderId: string;
}
