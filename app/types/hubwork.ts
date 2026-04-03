import type { Timestamp } from "@google-cloud/firestore";

// --- Firestore document types ---

export type HubworkAccountPlan = "lite" | "pro" | "granted";
export type HubworkBillingStatus = "active" | "past_due" | "canceled";
export type HubworkAccountStatus = "enabled" | "disabled";
export type HubworkDomainStatus = "none" | "pending_dns" | "provisioning_cert" | "active" | "failed";

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
  billingStatus: HubworkBillingStatus;
  accountStatus: HubworkAccountStatus;
  domainStatus: HubworkDomainStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
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

/** Check if account has Pro features (Sheets, web builder, scheduled, server-side) */
export function hasProFeatures(account: HubworkAccount): boolean {
  return account.accountStatus === "enabled" && (account.plan === "pro" || account.plan === "granted");
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
