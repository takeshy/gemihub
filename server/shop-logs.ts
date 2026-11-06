import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import type { Store } from "./store.ts";
import { PayPalError, type PaymentGateway } from "./paypal.ts";
import type { PayPalToolProvider } from "./paypal-ops.ts";
import { articleAccessDays, type ArticleAccessDays, type ArticleAccessResult, type SiteTrafficResult } from "../shared/article-access.ts";

export const logRetentionDays = 90;
export const customerLogKey = (shopId: string, email: string) => createHash("sha256").update(`${shopId}:${email.trim().toLowerCase()}`).digest("hex");
export type ShopLog = {
  id: string; shopId: string; at: string; requestId: string;
  kind: "access" | "error" | "paypal" | "activity" | "page_view"; ok: boolean;
  postId?: string;
  visitorKey?: string;
  day?: string;
  customerKey?: string;
  operation: string; durationMs?: number; status?: number; upstreamStatus?: number;
  errorType?: string; issue?: string; debugId?: string;
  errorCode?: string; location?: string; providerStatus?: string;
  orderId?: string; captureId?: string; refundId?: string; bookingId?: string;
  references?: string[];
};
export type ShopLogFilters = { kind?: ShopLog["kind"]; failuresOnly?: boolean; reference?: string };
type Context = { shopId?: string; requestId: string; operation?: string };
/** Only route resolution assigns the tenant. Never accept a tenant from an AI tool argument. */
export class ShopLogs {
  private context = new AsyncLocalStorage<Context>();
  private pending = new Set<Promise<void>>();
  constructor(private store: Store) {}
  run<T>(shopId: string | undefined, fn: () => T, operation?: string) {
    return this.context.run({ shopId, requestId: randomUUID(), operation }, fn);
  }
  forShop<T>(shopId: string, fn: () => T) {
    return this.context.getStore()?.shopId === shopId ? fn() : this.run(shopId, fn);
  }
  bind(shopId: string) { const context = this.context.getStore(); if (context) context.shopId = shopId; }
  setOperation(operation: string) { const context = this.context.getStore(); if (context) context.operation = operation; }
  activity(shopId: string, email: string, operation: string, bookingId?: string, eventKey?: string) {
    const customerKey = customerLogKey(shopId, email);
    // Logins and page opens are repeatable. Business outcomes use one immutable receipt even
    // when a lost response, notification failure or reconciliation replays the operation.
    const id = bookingId ? createHash("sha256").update(JSON.stringify([shopId, customerKey, operation, bookingId, eventKey || ""])).digest("hex") : undefined;
    this.store.afterCommit(() => this.forShop(shopId, () => this.record({ kind: "activity", ok: true, operation, customerKey, ...(bookingId ? { bookingId: safeId(bookingId) } : {}) }, id)));
  }
  pageView(shopId: string, operation: string, day: string, visitorId?: string, postId?: string) {
    const visitorKey = visitorId ? createHash("sha256").update(`${shopId}:${visitorId}`).digest("hex") : undefined;
    this.forShop(shopId, () => this.record({ kind: "page_view", ok: true, operation, postId, visitorKey, day }));
  }
  async customerActivity(shopId: string, email: string, from?: string) {
    const now = Date.now();
    const start = new Date(Math.max(from ? Date.parse(from) : 0, now - logRetentionDays * 86400000)).toISOString();
    const rows = await this.store.queryShopLogs(shopId, start, new Date(now).toISOString(), 101, customerLogKey(shopId, email));
    return { rows: rows.slice(0, 100).map(({ id, at, operation, bookingId }) => ({ id, at, operation, bookingId })), truncated: rows.length > 100, retentionDays: logRetentionDays };
  }
  record(input: Omit<ShopLog, "id" | "shopId" | "at" | "requestId">, id: string = randomUUID()) {
    const context = this.context.getStore();
    if (!context?.shopId) return;
    const log: ShopLog = { ...input, id, shopId: context.shopId, at: new Date().toISOString(), requestId: context.requestId };
    // Logging is independent of business transactions and lock leases. A failed payment's history
    // survives rollback; a log storage outage must never turn a successful charge into a failure.
    const work = this.store.appendShopLog(log).catch(() => {
      console.warn(JSON.stringify({ event: "shop_log_write_failed", shopId: log.shopId, logId: log.id }));
    });
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }
  async drain() { await Promise.all([...this.pending]); }
  error(error: unknown, operation = this.context.getStore()?.operation || "background") {
    const status = error instanceof z.ZodError ? 400 : Number((error as { status?: number } | null)?.status) || 500;
    const code = (error as { code?: unknown } | null)?.code;
    const location = error instanceof Error ? error.stack?.match(/server\/[a-zA-Z0-9_-]+\.[cm]?[jt]s:\d+:\d+/)?.[0] : undefined;
    this.record({ kind: "error", ok: false, operation, status, errorType: error instanceof z.ZodError ? "validation" : error instanceof PayPalError ? "paypal" : status < 500 ? "http" : "internal", errorCode: typeof code === "string" && /^[A-Z_]{2,64}$/.test(code) ? code : undefined, location });
  }
  toolsFor(shopId: string, articleCounts?: (days: ArticleAccessDays) => Promise<ArticleAccessResult>, dailyTraffic?: (days: ArticleAccessDays) => Promise<SiteTrafficResult>): PayPalToolProvider {
    return {
      tools: [{ name: "search_shop_logs", description: tr("このお店のアクセス・エラー・PayPalの処理履歴を検索する。保存は90日、検索期間は最大31日。記録がないことと正常動作を混同しない。"), parametersJsonSchema: { type: "object", properties: {
        from: { type: "string", description: tr("開始日時（ISO 8601、省略時は24時間前）") },
        to: { type: "string", description: tr("終了日時（ISO 8601、省略時は現在）") },
        kind: { type: "string", enum: ["all", "access", "error", "paypal", "activity", "page_view"] },
        customer: { type: "string", description: tr("行動履歴を調べるお客様のメールアドレス。ログには保存せず照合にだけ使う") },
        failuresOnly: { type: "boolean" },
        reference: { type: "string", description: tr("予約・注文・決済・返金IDまたはリクエストID（完全一致）") },
      } } }, ...(articleCounts ? [{ name: "get_article_access_counts", description: tr("ブログ・お知らせの公開記事別PVとユニークブラウザ数を集計する。ログの検索上限に影響されない集計を使う。"), parametersJsonSchema: { type: "object", properties: { days: { type: "integer", enum: [...articleAccessDays] } } } }] : []), ...(dailyTraffic ? [{ name: "get_daily_traffic", description: tr("お店の日別PVとユニークブラウザ数を調べる。ログイン前も含み、同じ日の同じブラウザは複数ページ見ても1件。日付はお店のタイムゾーン。実人数の目安。"), parametersJsonSchema: { type: "object", properties: { days: { type: "integer", enum: [...articleAccessDays] } } } }] : [])],
      invoke: async (name, args) => {
        if (name === "get_daily_traffic" && dailyTraffic) {
          const input = z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }).strict().parse(args || {});
          return { result: await dailyTraffic(input.days), source: { path: "logs:traffic", title: tr("お店の日別アクセス数") } };
        }
        if (name === "get_article_access_counts" && articleCounts) {
          const input = z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }).strict().parse(args || {});
          return { result: await articleCounts(input.days), source: { path: "logs:articles", title: tr("ブログ・お知らせのアクセス数") } };
        }
        if (name !== "search_shop_logs") throw new Error(tr("この操作は利用できません"));
        const input = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), kind: z.enum(["all", "access", "error", "paypal", "activity", "page_view"]).default("all"), customer: z.email().optional(), failuresOnly: z.boolean().default(false), reference: z.string().min(1).max(200).optional() }).strict().parse(args || {});
        const now = Date.now(), to = Math.min(input.to ? Date.parse(input.to) : now, now), from = Math.max(input.from ? Date.parse(input.from) : to - 86400000, now - logRetentionDays * 86400000);
        if (from > to || to - from > 31 * 86400000) throw new Error(tr("ログの検索は過去90日以内、1回31日以内の期間を指定してください。"));
        // Bounded reads: counts explicitly describe the scanned window, never the whole period
        // when traffic exceeded the cap. No unbounded tenant-wide download into the model.
        const scanned = await this.store.queryShopLogs(shopId, new Date(from).toISOString(), new Date(to).toISOString(), 5001, input.customer ? customerLogKey(shopId, input.customer) : undefined, { kind: input.kind === "all" ? undefined : input.kind, failuresOnly: input.failuresOnly, reference: input.reference });
        const rows = scanned.slice(0, 5000);
        const counts = new Map<string, { kind: string; operation: string; ok: boolean; status?: number; count: number }>();
        for (const row of rows) {
          const key = JSON.stringify([row.kind, row.operation, row.ok, row.status]);
          const count = counts.get(key) || { kind: row.kind, operation: row.operation, ok: row.ok, status: row.status, count: 0 };
          count.count++; counts.set(key, count);
        }
        return { result: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), retentionDays: logRetentionDays, scanned: rows.length, matched: rows.length, scanTruncated: scanned.length > 5000, rowsTruncated: rows.length > 100, summary: [...counts.values()].slice(0, 100), summaryTruncated: counts.size > 100, rows: rows.slice(0, 100), coverage: "Filters are applied before the result limit. Application and client-reported events only; no earlier or unreported browser/CDN/infrastructure-only events. Missing logs do not prove success." }, source: { path: "logs:shop", title: tr("お店のアクセス・エラー・PayPalログ") } };
      },
    };
  }
}

// Route templates preserve useful operations without recording path parameters, query strings,
// cookies, emails, request/response bodies, IP addresses or exception messages.
const routeWords = new Set("api shops public s bookings checkouts slots transfers waitlist auth email info verify cancel capture refund refunds payments paypal consult customers inquiries images menu-images pages blogs announcements sitemap.xml robots.txt accept settings operations alerts resync retry propose documents build-context chat complete confirm quote coupons mine posts export calendar connection staff login logout history publish preview assets _assets".split(" "));
// Views are anonymous and client addresses cannot be trusted behind the proxies, so each shop has
// one budget per minute. It bounds writes from forged visitor IDs, which need no proof of a browser.
export const pageViewShopLimit = 1200;
export const pageViewAnonymousLimit = 240;
export function logRoute(path: string) { return path.split("/").slice(0, 12).map(part => !part || routeWords.has(part) ? part : ":id").join("/"); }
const safeId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : undefined;

/** Preserve gateway behavior, while recording only explicitly allowed diagnostic fields. */
export function loggedPaymentGateway(gateway: PaymentGateway, logs: ShopLogs): PaymentGateway {
  return new Proxy(gateway, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      const start = Date.now(), operation = String(property);
      const identifiers = operation === "create" ? { bookingId: safeId(args[0]) } : ["order", "capture"].includes(operation) ? { orderId: safeId(args[0]) } : ["refund", "captureStatus"].includes(operation) ? { captureId: safeId(args[0]) } : operation === "refundStatus" ? { refundId: safeId(args[0]) } : {};
      try {
        const result = await value.apply(target, args);
        const id = safeId(result?.id);
        const providerStatus = typeof result?.status === "string" && /^[A-Z_]{1,40}$/.test(result.status) ? result.status : undefined;
        logs.record({ kind: "paypal", ok: true, operation, providerStatus, durationMs: Date.now() - start, ...identifiers, ...(operation === "create" && id ? { orderId: id } : operation === "refund" && id ? { refundId: id } : {} ) });
        return result;
      } catch (error) {
        logs.record({ kind: "paypal", ok: false, operation, durationMs: Date.now() - start, ...identifiers, errorType: error instanceof PayPalError ? "paypal" : "gateway", ...(error instanceof PayPalError ? { upstreamStatus: error.upstreamStatus, issue: error.diagnosticIssue || error.issue, debugId: safeId(error.debugId) } : {}) });
        throw error;
      }
    };
  } });
}
