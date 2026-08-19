import { FieldValue } from "@google-cloud/firestore";
import type { StreamChunkUsage } from "~/types/chat";
import { getFirestore, ORGANIZATIONS } from "./firestore.server";
import { getOrganization, getOrgMember } from "./organizations.server";

export interface AiBillingContext {
  orgId: string;
  uid: string;
}

export interface AiUsageSummary {
  month: string;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Purchased budget top-ups for the month (org summary only). */
  topUpUsd?: number;
}

export class AiBudgetExceededError extends Error {
  status = 429 as const;
  constructor(public readonly scope: "organization" | "user", public readonly limitUsd: number) {
    super(`${scope} monthly AI budget of $${limitUsd.toFixed(2)} has been reached`);
    this.name = "AiBudgetExceededError";
  }
}

type Price = { input: number; output: number };

/**
 * Vertex AI budget included with the Business plan, in USD per month. Set on
 * the organization at provisioning time; owners may raise or lower it, and
 * purchased top-ups extend it for the current month on top of this figure.
 */
export const BUSINESS_INCLUDED_AI_BUDGET_USD = 30;

const DEFAULT_PRICES_PER_MILLION: Record<string, Price> = {
  "gemini-3.1-pro-preview": { input: 2, output: 12 },
  "gemini-3.1-pro-preview-customtools": { input: 2, output: 12 },
  "gemini-3.7-flash": { input: 0.5, output: 3 },
  "gemini-3.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3-pro-image-preview": { input: 2, output: 12 },
  "gemini-3.1-flash-image-preview": { input: 0.5, output: 3 },
  "gemma-4-31b-it": { input: 1, output: 1 },
  "gemma-4-26b-a4b-it": { input: 1, output: 1 },
};

function prices(): Record<string, Price> {
  const raw = process.env.VERTEX_AI_PRICING_JSON;
  if (!raw) return DEFAULT_PRICES_PER_MILLION;
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<Price>>;
    const overrides: Record<string, Price> = {};
    for (const [model, value] of Object.entries(parsed)) {
      if (Number.isFinite(value.input) && Number.isFinite(value.output)) {
        overrides[model] = { input: Number(value.input), output: Number(value.output) };
      }
    }
    return { ...DEFAULT_PRICES_PER_MILLION, ...overrides };
  } catch {
    console.error("[ai-budget] invalid VERTEX_AI_PRICING_JSON; using defaults");
    return DEFAULT_PRICES_PER_MILLION;
  }
}

export function estimateVertexCostUsd(model: string, usage?: StreamChunkUsage): number {
  if (!usage) return 0;
  // Unknown models use a conservative fallback instead of bypassing budgets.
  const price = prices()[model] ?? { input: 2, output: 12 };
  const input = Math.max(0, usage.inputTokens ?? 0);
  const output = Math.max(0, usage.outputTokens ?? 0) + Math.max(0, usage.thinkingTokens ?? 0);
  return (input * price.input + output * price.output) / 1_000_000;
}

export function currentAiUsageMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function usageRefs(orgId: string, uid: string, month = currentAiUsageMonth()) {
  const orgUsage = getFirestore()
    .collection(ORGANIZATIONS).doc(orgId)
    .collection("aiUsage").doc(month);
  return { orgUsage, userUsage: orgUsage.collection("users").doc(uid), month };
}

function microsToUsd(value: unknown): number {
  return (typeof value === "number" && Number.isFinite(value) ? value : 0) / 1_000_000;
}

export async function assertAiBudgetAvailable(context: AiBillingContext): Promise<void> {
  const [org, member] = await Promise.all([
    getOrganization(context.orgId),
    getOrgMember(context.orgId, context.uid),
  ]);
  if (!org) throw new Error("AI billing context is not accessible");
  const { orgUsage, userUsage } = usageRefs(context.orgId, context.uid);
  const [orgSnap, userSnap] = await Promise.all([orgUsage.get(), userUsage.get()]);
  const orgSpent = microsToUsd(orgSnap.data()?.estimatedCostMicros);
  const userSpent = microsToUsd(userSnap.data()?.estimatedCostMicros);
  // Purchased top-ups extend the organization limit for the current month.
  const topUpUsd = microsToUsd(orgSnap.data()?.topUpMicros);
  const orgLimit = org.aiSettings.monthlyBudgetUsd;
  const effectiveOrgLimit = orgLimit != null && orgLimit > 0 ? orgLimit + topUpUsd : orgLimit;
  // Project-only external collaborators inherit the organization default.
  const userLimit = member?.monthlyBudgetUsdOverride ?? org.aiSettings.defaultUserMonthlyBudgetUsd;
  if (effectiveOrgLimit != null && effectiveOrgLimit > 0 && orgSpent >= effectiveOrgLimit) {
    throw new AiBudgetExceededError("organization", effectiveOrgLimit);
  }
  if (userLimit != null && userLimit > 0 && userSpent >= userLimit) {
    throw new AiBudgetExceededError("user", userLimit);
  }
}

export async function recordAiUsage(
  context: AiBillingContext,
  model: string,
  usage?: StreamChunkUsage,
): Promise<number> {
  if (!usage) return 0;
  const estimatedCostUsd = estimateVertexCostUsd(model, usage);
  const estimatedCostMicros = Math.max(0, Math.ceil(estimatedCostUsd * 1_000_000));
  const inputTokens = Math.max(0, usage.inputTokens ?? 0);
  const outputTokens = Math.max(0, usage.outputTokens ?? 0) + Math.max(0, usage.thinkingTokens ?? 0);
  const { orgUsage, userUsage, month } = usageRefs(context.orgId, context.uid);
  const increment = {
    month,
    estimatedCostMicros: FieldValue.increment(estimatedCostMicros),
    inputTokens: FieldValue.increment(inputTokens),
    outputTokens: FieldValue.increment(outputTokens),
    requests: FieldValue.increment(1),
    updatedAt: Date.now(),
  };
  const batch = getFirestore().batch();
  batch.set(orgUsage, increment, { merge: true });
  batch.set(userUsage, { ...increment, uid: context.uid, model }, { merge: true });
  await batch.commit();
  return estimatedCostUsd;
}

/**
 * Add a purchased budget top-up for the current month. `eventId` (the Stripe
 * checkout session id) makes retried webhook deliveries idempotent: the
 * increment happens only when the event document is newly created.
 */
export async function addAiBudgetTopUp(
  orgId: string,
  usd: number,
  eventId: string,
): Promise<boolean> {
  if (!(usd > 0)) return false;
  const month = currentAiUsageMonth();
  const fs = getFirestore();
  const usageRef = fs.collection(ORGANIZATIONS).doc(orgId).collection("aiUsage").doc(month);
  const eventRef = usageRef.collection("topupEvents").doc(eventId);
  return fs.runTransaction(async (tx) => {
    const seen = await tx.get(eventRef);
    if (seen.exists) return false;
    tx.set(eventRef, { usd, createdAt: Date.now() });
    tx.set(
      usageRef,
      { month, topUpMicros: FieldValue.increment(Math.round(usd * 1_000_000)), updatedAt: Date.now() },
      { merge: true },
    );
    return true;
  });
}

function toSummary(month: string, data: Record<string, unknown> | undefined): AiUsageSummary {
  return {
    month,
    estimatedCostUsd: microsToUsd(data?.estimatedCostMicros),
    inputTokens: typeof data?.inputTokens === "number" ? data.inputTokens : 0,
    outputTokens: typeof data?.outputTokens === "number" ? data.outputTokens : 0,
  };
}

export async function getOrganizationAiUsage(orgId: string): Promise<{
  organization: AiUsageSummary;
  users: Record<string, AiUsageSummary>;
}> {
  const month = currentAiUsageMonth();
  const orgUsage = getFirestore().collection(ORGANIZATIONS).doc(orgId).collection("aiUsage").doc(month);
  const [orgSnap, usersSnap] = await Promise.all([orgUsage.get(), orgUsage.collection("users").get()]);
  return {
    organization: {
      ...toSummary(month, orgSnap.data()),
      topUpUsd: microsToUsd(orgSnap.data()?.topUpMicros),
    },
    users: Object.fromEntries(usersSnap.docs.map((doc) => [doc.id, toSummary(month, doc.data())])),
  };
}
