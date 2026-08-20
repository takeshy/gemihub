import type { Timestamp } from "@google-cloud/firestore";

/**
 * USD credited per purchased Vertex AI budget top-up unit. Must match the
 * Stripe price behind STRIPE_PRICE_ID_VERTEX_TOPUP{,_USD} — the webhook
 * credits this amount per unit, so a mismatch hands out budget nobody paid
 * for. Lives here rather than in ai-budget.server.ts because the settings UI
 * renders it, and a client import of a .server module fails the build.
 */
export const VERTEX_TOPUP_UNIT_USD = 10;

/** The same unit priced in JPY. Must match STRIPE_PRICE_ID_VERTEX_TOPUP. */
export const VERTEX_TOPUP_UNIT_JPY = 1500;

/** Unit counts a single checkout may buy. */
export const VERTEX_TOPUP_UNIT_CHOICES = [1, 2, 3, 5, 10] as const;

// --- Firestore document types ---

export type HubworkAccountPlan = "lite" | "business" | "granted";
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
  /** Organization provisioned by a Business subscription (owner = purchaser). */
  orgId?: string;
  /** The org's default shared project. */
  projectId?: string;
  activeScheduleRevision?: string;
  createdAt: Timestamp;
}

/** Check if account is active (enabled status and billing not past_due) */
export function isHubworkFeatureAvailable(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && account.billingStatus !== "past_due";
}

/** Check if account has paid features (Gmail, no upload limit, etc.) — lite or above */
export function hasPaidFeatures(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && !!account.plan;
}

export function isActivePremiumAccount(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && !!account.plan && account.billingStatus === "active";
}

/** Check if account has Business features (Sheets, web builder, scheduled, server-side, organization) */
export function hasBusinessFeatures(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && (account.plan === "business" || account.plan === "granted");
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
