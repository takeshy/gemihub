import { FieldValue } from "@google-cloud/firestore";
import type { StreamChunkUsage } from "~/types/chat";
import { getFirestore, ORGANIZATIONS, USERS } from "./firestore.server";
import { getOrganization, getOrgMember } from "./organizations.server";
import { VERTEX_MODEL_PRICING, SEARCH_GROUNDING_COST } from "./ai/models";

export interface AiBillingContext {
  /** Required for scope "org"; absent for scope "personal". */
  orgId?: string;
  uid: string;
  scope: "org" | "personal";
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
  constructor(
    public readonly scope: "organization" | "user" | "personal",
    public readonly limitUsd: number,
  ) {
    const label = scope === "personal" ? "personal AI credit" : `${scope} monthly AI budget`;
    super(`${label} of $${limitUsd.toFixed(2)} has been reached`);
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

// Defined in ~/types/hubwork so the settings UI can render it without
// importing this server-only module.
export { VERTEX_TOPUP_UNIT_USD } from "~/types/hubwork";

/** Per-token price → per-million, without the float noise of a raw multiply. */
function perMillion(perToken: number): number {
  return Math.round(perToken * 1e12) / 1e6;
}

/**
 * Derived from the one published price table (`ai/models.ts`) so a budget can
 * never be spent at a lower rate than Google actually bills us. This used to
 * be a second hand-maintained table and it had drifted badly under-price —
 * Flash at $0.5/$3 against a real $1.50/$7.50, and both image models' output
 * at $12 against $60–$120. Every dollar of that gap was an over-run we paid
 * for and the organization's budget never saw.
 */
const DEFAULT_PRICES_PER_MILLION: Record<string, Price> = Object.fromEntries(
  Object.entries(VERTEX_MODEL_PRICING).map(([model, price]) => [
    model,
    { input: perMillion(price.input), output: perMillion(price.output) },
  ]),
);

/** Google Search grounding for a model the table does not list yet. */
const DEFAULT_SEARCH_GROUNDING_COST = 14 / 1000;

export interface AiUsageExtras {
  /**
   * Requests that carried the Google Search tool. Grounding is billed per
   * prompt on top of tokens, so a search-heavy session costs materially more
   * than its token count suggests.
   */
  searchGroundingRequests?: number;
}

function groundingCostUsd(model: string, extras?: AiUsageExtras): number {
  const requests = Math.max(0, Math.trunc(extras?.searchGroundingRequests ?? 0));
  if (requests === 0) return 0;
  return requests * (SEARCH_GROUNDING_COST[model] ?? DEFAULT_SEARCH_GROUNDING_COST);
}

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

/**
 * Whether a model has a price we can charge an organization's budget with.
 *
 * An unpriced model falls back to the Pro-tier estimate below, which is about
 * a tenth of what an image model actually costs — the gap is spend we absorb
 * and the budget never sees. Gate model selection on this instead: add the
 * model to `MODEL_PRICING` (or `VERTEX_AI_PRICING_JSON`) to enable it.
 */
export function isVertexModelPriced(model: string): boolean {
  return Object.hasOwn(prices(), model);
}

export function estimateVertexCostUsd(
  model: string,
  usage?: StreamChunkUsage,
  extras?: AiUsageExtras,
): number {
  const grounding = groundingCostUsd(model, extras);
  if (!usage) return grounding;
  // Unknown models use a conservative fallback instead of bypassing budgets.
  const price = prices()[model] ?? { input: 2, output: 12 };
  const input = Math.max(0, usage.inputTokens ?? 0);
  const output = Math.max(0, usage.outputTokens ?? 0) + Math.max(0, usage.thinkingTokens ?? 0);
  return (input * price.input + output * price.output) / 1_000_000 + grounding;
}

export function currentAiUsageMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month key preceding `month` ("2026-01" → "2025-12"). */
export function previousAiUsageMonth(month = currentAiUsageMonth()): string {
  const [year, index] = month.split("-").map(Number);
  return index > 1
    ? `${year}-${String(index - 1).padStart(2, "0")}`
    : `${year - 1}-12`;
}

/**
 * One budget window: the span whose spend counts against the monthly limit.
 *
 * With a billing anchor the window follows the subscription cycle (the 28th
 * to the 28th, say), so a single paid month grants exactly one budget — under
 * calendar months a subscription starting late in a month would get the tail
 * of that month AND the whole next one, which can cost more than the
 * subscription earns. Organizations without an anchor keep calendar months,
 * so existing usage documents stay addressable.
 */
export interface BudgetPeriod {
  /** Firestore document id: "YYYY-MM" (calendar) or "YYYY-MM-DD" (billing). */
  key: string;
  startMs: number;
  endMs: number;
  anchorDay: number | null;
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** The anchor day clamped into a month, matching Stripe's short-month rule. */
function anchoredDay(anchorDay: number, year: number, monthIndex: number): number {
  return Math.min(anchorDay, daysInUtcMonth(year, monthIndex));
}

function calendarPeriod(now: Date): BudgetPeriod {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  return {
    key: currentAiUsageMonth(now),
    startMs: Date.UTC(year, monthIndex, 1),
    endMs: Date.UTC(year, monthIndex + 1, 1),
    anchorDay: null,
  };
}

/** The budget window containing `now`. */
export function resolveBudgetPeriod(
  anchorDay: number | null | undefined,
  now = new Date(),
): BudgetPeriod {
  if (anchorDay == null || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    return calendarPeriod(now);
  }
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const thisMonthAnchor = Date.UTC(year, monthIndex, anchoredDay(anchorDay, year, monthIndex));
  // Before this month's anchor day the window started in the previous month.
  const startsThisMonth = now.getTime() >= thisMonthAnchor;
  const startYear = startsThisMonth ? year : (monthIndex === 0 ? year - 1 : year);
  const startMonth = startsThisMonth ? monthIndex : (monthIndex === 0 ? 11 : monthIndex - 1);
  return periodStartingAt(anchorDay, startYear, startMonth);
}

function periodStartingAt(anchorDay: number, year: number, monthIndex: number): BudgetPeriod {
  const startDay = anchoredDay(anchorDay, year, monthIndex);
  const startMs = Date.UTC(year, monthIndex, startDay);
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonth = monthIndex === 11 ? 0 : monthIndex + 1;
  const endMs = Date.UTC(nextYear, nextMonth, anchoredDay(anchorDay, nextYear, nextMonth));
  return {
    key: new Date(startMs).toISOString().slice(0, 10),
    startMs,
    endMs,
    anchorDay,
  };
}

/** The window immediately before `period`. */
export function previousBudgetPeriod(period: BudgetPeriod): BudgetPeriod {
  if (period.anchorDay == null) {
    const key = previousAiUsageMonth(period.key);
    const [year, month] = key.split("-").map(Number);
    return {
      key,
      startMs: Date.UTC(year, month - 1, 1),
      endMs: Date.UTC(year, month, 1),
      anchorDay: null,
    };
  }
  const start = new Date(period.startMs);
  const monthIndex = start.getUTCMonth();
  return monthIndex === 0
    ? periodStartingAt(period.anchorDay, start.getUTCFullYear() - 1, 11)
    : periodStartingAt(period.anchorDay, start.getUTCFullYear(), monthIndex - 1);
}

/** The window after `period` — where this period's top-ups stop being usable. */
export function nextBudgetPeriod(period: BudgetPeriod): BudgetPeriod {
  if (period.anchorDay == null) {
    const [year, month] = period.key.split("-").map(Number);
    const nextIndex = month; // 0-based index of the following month
    const nextYear = nextIndex > 11 ? year + 1 : year;
    const normalized = nextIndex > 11 ? 0 : nextIndex;
    return {
      key: `${nextYear}-${String(normalized + 1).padStart(2, "0")}`,
      startMs: Date.UTC(nextYear, normalized, 1),
      endMs: Date.UTC(nextYear, normalized + 1, 1),
      anchorDay: null,
    };
  }
  const start = new Date(period.endMs);
  return periodStartingAt(period.anchorDay, start.getUTCFullYear(), start.getUTCMonth());
}

/** Last day a top-up bought in `period` can be used (end of the next window). */
export function topUpExpiryDate(period: BudgetPeriod): string {
  // endMs is exclusive, so step back a day to name the last usable date.
  return new Date(nextBudgetPeriod(period).endMs - 86_400_000).toISOString().slice(0, 10);
}

// The anchor is read on every usage write; cache it briefly instead of
// fetching the organization document each time.
const anchorCache = new Map<string, { anchorDay: number | null; cachedAt: number }>();
const ANCHOR_TTL_MS = 5 * 60 * 1000;

async function budgetAnchorDay(orgId: string): Promise<number | null> {
  const cached = anchorCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < ANCHOR_TTL_MS) return cached.anchorDay;
  const org = await getOrganization(orgId);
  const anchorDay = typeof org?.budgetAnchorDay === "number" ? org.budgetAnchorDay : null;
  anchorCache.set(orgId, { anchorDay, cachedAt: Date.now() });
  return anchorDay;
}

export function _resetBudgetAnchorCacheForTests(): void {
  anchorCache.clear();
}

/** The current window for an organization. */
export async function currentBudgetPeriod(orgId: string, now = new Date()): Promise<BudgetPeriod> {
  return resolveBudgetPeriod(await budgetAnchorDay(orgId), now);
}

function usageRefs(orgId: string, uid: string, periodKey: string) {
  const orgUsage = getFirestore()
    .collection(ORGANIZATIONS).doc(orgId)
    .collection("aiUsage").doc(periodKey);
  return { orgUsage, userUsage: orgUsage.collection("users").doc(uid) };
}

function microsToUsd(value: unknown): number {
  return (typeof value === "number" && Number.isFinite(value) ? value : 0) / 1_000_000;
}

export interface TopUpState {
  /** Usable this month: purchased this month plus what carried over. */
  availableUsd: number;
  purchasedThisMonthUsd: number;
  /** Unused part of last month's purchases; expires at the end of this month. */
  carriedOverUsd: number;
  /** Date the top-ups purchased THIS month stop being usable. */
  expiresOn: string;
}

/**
 * Resolve an organization's usable top-up balance.
 *
 * A top-up is valid through the end of the month AFTER it was purchased, so
 * the balance is this month's purchases plus whatever was left of last
 * month's. Spend is charged to the included budget first and to top-ups only
 * beyond it, which is what makes "left over" meaningful.
 *
 * Carry-over is computed from the two most recent months rather than tracked
 * as a running balance: it needs no write-path changes, and it can only ever
 * err in the customer's favour (a month that also spent an older carry-over
 * attributes that spend to its own purchases first).
 */
export async function resolveOrgTopUp(
  orgId: string,
  baseLimitUsd: number | null | undefined,
  period?: BudgetPeriod,
): Promise<TopUpState> {
  const usage = getFirestore().collection(ORGANIZATIONS).doc(orgId).collection("aiUsage");
  const current = period ?? (await currentBudgetPeriod(orgId));
  const previous = previousBudgetPeriod(current);
  const [currentSnap, previousSnap] = await Promise.all([
    usage.doc(current.key).get(),
    usage.doc(previous.key).get(),
  ]);

  const purchasedThisMonthUsd = microsToUsd(currentSnap.data()?.topUpMicros);
  const purchasedLastMonthUsd = microsToUsd(previousSnap.data()?.topUpMicros);
  const spentLastMonthUsd = microsToUsd(previousSnap.data()?.estimatedCostMicros);
  const base = baseLimitUsd != null && baseLimitUsd > 0 ? baseLimitUsd : 0;
  const topUpSpentLastMonth = Math.max(0, spentLastMonthUsd - base);
  const carriedOverUsd = Math.max(0, purchasedLastMonthUsd - topUpSpentLastMonth);

  return {
    availableUsd: purchasedThisMonthUsd + carriedOverUsd,
    purchasedThisMonthUsd,
    carriedOverUsd,
    expiresOn: topUpExpiryDate(current),
  };
}

export async function assertAiBudgetAvailable(context: AiBillingContext): Promise<void> {
  if (context.scope === "personal") {
    const balance = await getPersonalAiBalance(context.uid);
    if (balance.balanceUsd <= 0) {
      throw new AiBudgetExceededError("personal", 0);
    }
    return;
  }

  const orgId = context.orgId;
  if (!orgId) throw new Error("AI billing context is missing orgId for org scope");
  const [org, member] = await Promise.all([
    getOrganization(orgId),
    getOrgMember(orgId, context.uid),
  ]);
  if (!org) throw new Error("AI billing context is not accessible");
  const period = resolveBudgetPeriod(org.budgetAnchorDay ?? null);
  const { orgUsage, userUsage } = usageRefs(orgId, context.uid, period.key);
  const [orgSnap, userSnap] = await Promise.all([orgUsage.get(), userUsage.get()]);
  const orgSpent = microsToUsd(orgSnap.data()?.estimatedCostMicros);
  const userSpent = microsToUsd(userSnap.data()?.estimatedCostMicros);
  const orgLimit = org.aiSettings.monthlyBudgetUsd;
  // Purchased top-ups extend the limit; they stay usable through the end of
  // the month after purchase, so last month's unused balance counts too.
  const { availableUsd: topUpUsd } = await resolveOrgTopUp(orgId, orgLimit, period);
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
  extras?: AiUsageExtras,
): Promise<number> {
  const searchRequests = Math.max(0, Math.trunc(extras?.searchGroundingRequests ?? 0));
  // Grounding is billed even when the response carried no usage metadata.
  if (!usage && searchRequests === 0) return 0;
  const estimatedCostUsd = estimateVertexCostUsd(model, usage, extras);
  const estimatedCostMicros = Math.max(0, Math.ceil(estimatedCostUsd * 1_000_000));
  const inputTokens = Math.max(0, usage?.inputTokens ?? 0);
  const outputTokens = Math.max(0, usage?.outputTokens ?? 0) + Math.max(0, usage?.thinkingTokens ?? 0);

  if (context.scope === "personal") {
    return recordPersonalAiUsage(context.uid, model, estimatedCostUsd, estimatedCostMicros, inputTokens, outputTokens, searchRequests);
  }

  const orgId = context.orgId;
  if (!orgId) throw new Error("AI billing context is missing orgId for org scope");
  const period = await currentBudgetPeriod(orgId);
  const { orgUsage, userUsage } = usageRefs(orgId, context.uid, period.key);
  const increment = {
    month: period.key,
    estimatedCostMicros: FieldValue.increment(estimatedCostMicros),
    inputTokens: FieldValue.increment(inputTokens),
    outputTokens: FieldValue.increment(outputTokens),
    requests: FieldValue.increment(1),
    searchGroundingRequests: FieldValue.increment(searchRequests),
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
  const period = await currentBudgetPeriod(orgId);
  const fs = getFirestore();
  const usageRef = fs.collection(ORGANIZATIONS).doc(orgId).collection("aiUsage").doc(period.key);
  const eventRef = usageRef.collection("topupEvents").doc(eventId);
  return fs.runTransaction(async (tx) => {
    const seen = await tx.get(eventRef);
    if (seen.exists) return false;
    tx.set(eventRef, { usd, createdAt: Date.now() });
    tx.set(
      usageRef,
      { month: period.key, topUpMicros: FieldValue.increment(Math.round(usd * 1_000_000)), updatedAt: Date.now() },
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
  period: BudgetPeriod;
  organization: AiUsageSummary;
  users: Record<string, AiUsageSummary>;
}> {
  const period = await currentBudgetPeriod(orgId);
  const orgUsage = getFirestore().collection(ORGANIZATIONS).doc(orgId).collection("aiUsage").doc(period.key);
  const [orgSnap, usersSnap] = await Promise.all([orgUsage.get(), orgUsage.collection("users").get()]);
  return {
    period,
    organization: {
      ...toSummary(period.key, orgSnap.data()),
      topUpUsd: microsToUsd(orgSnap.data()?.topUpMicros),
    },
    users: Object.fromEntries(usersSnap.docs.map((doc) => [doc.id, toSummary(period.key, doc.data())])),
  };
}

// ---------------------------------------------------------------------------
// Personal (Drive-mount) Vertex AI billing — prepaid running balance
// ---------------------------------------------------------------------------

export interface PersonalAiBalance {
  /**
   * totalTopUpUsd - totalUsageUsd; the credit remaining for Vertex calls.
   * NOT clamped at zero: the balance is only checked when a request starts,
   * so a single long request can finish below zero. Hiding that would leave
   * the user's next top-up silently paying off an invisible debt.
   */
  balanceUsd: number;
  totalTopUpUsd: number;
  totalUsageUsd: number;
}

function personalBalanceRef(uid: string) {
  return getFirestore().collection(USERS).doc(uid).collection("aiBalance").doc("balance");
}

export async function getPersonalAiBalance(uid: string): Promise<PersonalAiBalance> {
  const snap = await personalBalanceRef(uid).get();
  const data = snap.data();
  const totalTopUpMicros = typeof data?.totalTopUpMicros === "number" ? data.totalTopUpMicros : 0;
  const totalUsageMicros = typeof data?.totalUsageMicros === "number" ? data.totalUsageMicros : 0;
  return {
    balanceUsd: (totalTopUpMicros - totalUsageMicros) / 1_000_000,
    totalTopUpUsd: totalTopUpMicros / 1_000_000,
    totalUsageUsd: totalUsageMicros / 1_000_000,
  };
}

async function recordPersonalAiUsage(
  uid: string,
  model: string,
  estimatedCostUsd: number,
  estimatedCostMicros: number,
  inputTokens: number,
  outputTokens: number,
  searchGroundingRequests: number,
): Promise<number> {
  const ref = personalBalanceRef(uid);
  const increment = {
    totalUsageMicros: FieldValue.increment(estimatedCostMicros),
    totalInputTokens: FieldValue.increment(inputTokens),
    totalOutputTokens: FieldValue.increment(outputTokens),
    totalRequests: FieldValue.increment(1),
    totalSearchGroundingRequests: FieldValue.increment(searchGroundingRequests),
    updatedAt: Date.now(),
  };
  await ref.set(increment, { merge: true });
  return estimatedCostUsd;
}

export async function addPersonalAiBudgetTopUp(
  uid: string,
  usd: number,
  eventId: string,
): Promise<boolean> {
  if (!(usd > 0)) return false;
  const fs = getFirestore();
  const ref = personalBalanceRef(uid);
  const eventRef = ref.collection("topupEvents").doc(eventId);
  return fs.runTransaction(async (tx) => {
    const seen = await tx.get(eventRef);
    if (seen.exists) return false;
    tx.set(eventRef, { usd, createdAt: Date.now() });
    tx.set(
      ref,
      { totalTopUpMicros: FieldValue.increment(Math.round(usd * 1_000_000)), updatedAt: Date.now() },
      { merge: true },
    );
    return true;
  });
}

export interface PersonalTopupEvent {
  id: string;
  usd: number;
  createdAt: number;
}

export async function getPersonalTopupHistory(uid: string, limit = 50): Promise<PersonalTopupEvent[]> {
  const snap = await personalBalanceRef(uid)
    .collection("topupEvents")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    usd: microsToUsd(doc.data()?.usd ? Math.round(doc.data().usd * 1_000_000) : 0),
    createdAt: typeof doc.data()?.createdAt === "number" ? doc.data().createdAt : 0,
  }));
}
