import { tr } from "../shared/i18n.ts";
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { logRetentionDays, type ShopLog, type ShopLogFilters } from "./shop-logs.ts";
import type { Checkout } from "./payments.ts";
import type { ShopConfig, Booking } from "./domain.ts";
import { judgeActive, type DemoGoogle } from "./judge.ts";
import { acquireLock, assertLocalLocks, assertLocks, lockLost, lockRenewMs, releaseLock, renewLock, type LockLease } from "./store-locks.ts";
export type Shop = {
  id: string;
  owner: string;
  slug: string;
  published: ShopConfig | null;
  publication?: "provisional" | "public";
  /** Completed immutable HTML release in the private storefront bucket. */
  storefrontRelease?: import("./storefront-build.tsx").StorefrontRelease;
  /** Releases kept after the current one (newest first); older ones are deleted. */
  storefrontPrevious?: import("./storefront-build.tsx").StorefrontRelease[];
  draft: ShopConfig | null;
  revision: number;
  /** Published changes; `request` keeps the owner's words so the reason can be answered later. */
  history: { at: string; summary: string; request?: string }[];
  google?: {
    folderId: string;
    specId: string;
    historyId: string;
    artifactIds?: Record<string, string>;
    artifactFolders?: Record<string, string>;
  };
  lastPublishedPlanId?: string;
  publishingPlanId?: string;
  publishingError?: string;
  designVersions?: import("./design-versions.ts").DesignVersion[];
  /** Durable cleanup queue; Drive trash failures are retried on the next history read/write. */
  designVersionTrash?: import("./design-versions.ts").DesignVersion[];
  designPublication?: import("./design-versions.ts").DesignPublication;
  /** Last backed-up operation, retained across retries of a partially written publication. */
  designBackupOperationId?: string;
  designRestore?: { requestId: string; version: import("./design-versions.ts").DesignVersion; at: string; target?: import("./design-versions.ts").DesignTarget };
  lastDesignRestoreId?: string;
  domain?: string;
  domainToken?: string;
  domainVerified?: boolean;
  /** Reset shops remain as audit records, but are never served or synchronized. */
  archivedAt?: string;
  /** Present on shops created through hackathon judge access; stored in the operator's demo Google Drive. */
  judge?: { createdAt: string; folderId?: string; archivedAt?: string };
  /** Region chosen from the owner's first visit, used for the first proposal. */
  regionDefault?: import("../shared/region.ts").Region;
  /** Last language the owner used; scheduled notifications and AI summaries follow it. */
  locale?: "ja" | "en";
  /** Owner settings for PayPal operations alerts. Absent means daily digest at 09:00, enabled. */
  paypalOps?: { notify: boolean; digestHour: number };
};
export type User = {
  email: string;
  name: string;
  shopId?: string;
  role: "owner" | "customer";
  /** Customer email verification never grants shop management permissions. */
  authMethod?: "email";
  refreshToken?: string;
  /** Calendar consent obtained during owner sign-in; encrypted, never sent to the browser. */
  calendarRefreshToken?: string;
  legacyNotes?: boolean;
  /** A hackathon judge account created from the invitation URL; it has no Google token of its own. */
  judge?: boolean;
  /** A new owner signed in with Google but has not entered the invitation password yet. */
  accessPending?: boolean;
};

export const isArchivedShop = (shop: Shop) => !!(shop.archivedAt || shop.judge?.archivedAt);
export const bookingLockKey = (shopId: string) => `bookings:${shopId}`;
export const mailLockKey = (shopId: string) => `mail:${shopId}`;
export const postLockKey = (shopId: string) => `post-writes:${shopId}`;

const chatKinds = new Set(["shopChat", "shopChatMessage"]);
const businessKinds = new Set(["booking", "inquiry", "inquiryInteraction", "member", "post", "customer", "customerNote", "couponCampaign", "couponGrant", "couponUse", "couponManual", ...chatKinds]);
type Entry = { kind: string; id: string; value: unknown };
export class Store {
  private shopLogs = new Map<string, ShopLog>();
  private articleVisitors = new Map<string, { shopId: string; postId: string; at: string }>();
  private dailyVisitors = new Set<string>();
  private logWrites = new Set<Promise<unknown>>();
  readonly memory: boolean;
  private firestore?: Firestore;
  private values = new Map<string, Entry>();
  private batch = new AsyncLocalStorage<Entry[]>();
  private commitActions = new AsyncLocalStorage<{ actions: (() => void)[]; status: "pending" | "committed" | "failed" }>();
  private localLocks = new Map<string, Promise<unknown>>();
  private closing?: Promise<void>;
  private leases = new AsyncLocalStorage<LockLease[]>();
  private activeLocks() {
    const leases = this.leases.getStore() || [];
    assertLocalLocks(leases);
    return leases;
  }
  constructor(mode?: string) {
    this.memory =
      mode === ":memory:" ||
      (!mode &&
        process.env.DEMO_MODE === "true" &&
        process.env.NODE_ENV !== "production");
    if (mode && mode !== ":memory:")
      throw new Error(
        tr("ファイル保存は廃止しました。Firestore を設定してください"),
      );
    if (!this.memory) {
      if (!process.env.GOOGLE_CLOUD_PROJECT)
        throw new Error("GOOGLE_CLOUD_PROJECT is required for Firestore");
      this.firestore = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        databaseId: process.env.FIRESTORE_DATABASE_ID || "gemihub",
      });
    }
  }
  private key(kind: string, id: string) {
    return createHash("sha256")
      .update(kind + ":" + id)
      .digest("hex");
  }
  async appendShopLog(log: ShopLog) {
    const clean = JSON.parse(JSON.stringify({ ...log, references: [...new Set([log.bookingId, log.orderId, log.captureId, log.refundId, log.requestId].filter((value): value is string => !!value))] })) as ShopLog;
    if (this.memory) {
      if (this.shopLogs.has(log.id)) return;
      this.shopLogs.set(log.id, clean);
      if (log.kind === "page_view" && log.postId && log.visitorKey) this.articleVisitors.set(`${log.shopId}:${log.postId}:${log.visitorKey}`, { shopId: log.shopId, postId: log.postId, at: log.at });
      if (log.kind === "page_view" && log.day && log.visitorKey) this.dailyVisitors.add(`${log.shopId}:${log.day}:${log.visitorKey}`);
      return;
    }
    const shopRef = this.firestore!.collection("gemihub_shop_logs").doc(log.shopId);
    const expiresAt = new Date(Date.parse(log.at) + logRetentionDays * 86400000);
    const batch = this.firestore!.batch();
    batch.create(shopRef.collection("gemihub_log_events").doc(log.id), { ...clean, expiresAt });
    if (log.kind === "page_view" && log.postId && log.visitorKey) batch.set(shopRef.collection("article_audiences").doc(log.postId).collection("gemihub_article_visitors").doc(log.visitorKey), { lastSeenAt: FieldValue.serverTimestamp(), expiresAt });
    if (log.kind === "page_view" && log.day && log.visitorKey) batch.set(shopRef.collection("daily_audiences").doc(log.day).collection("gemihub_daily_visitors").doc(log.visitorKey), { expiresAt });
    const write = batch.commit();
    this.logWrites.add(write);
    try { await write; } catch (error) { if ((error as { code?: number }).code !== 6) throw error; } finally { this.logWrites.delete(write); }
  }
  async queryShopLogs(shopId: string, from: string, to: string, limit: number, customerKey?: string, filters: ShopLogFilters = {}): Promise<ShopLog[]> {
    const earliest = new Date(Math.max(Date.parse(from), Date.now() - logRetentionDays * 86400000)).toISOString();
    if (this.memory) return [...this.shopLogs.values()].filter(row => row.shopId === shopId && (!customerKey || row.customerKey === customerKey) && (!filters.kind || row.kind === filters.kind) && (!filters.failuresOnly || !row.ok) && (!filters.reference || row.references?.includes(filters.reference)) && row.at >= earliest && row.at <= to).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, limit).map(row => structuredClone(row));
    let query = this.firestore!.collection("gemihub_shop_logs").doc(shopId).collection("gemihub_log_events").where("at", ">=", earliest).where("at", "<=", to);
    if (customerKey) query = query.where("customerKey", "==", customerKey);
    if (filters.kind) query = query.where("kind", "==", filters.kind);
    if (filters.failuresOnly) query = query.where("ok", "==", false);
    if (filters.reference) query = query.where("references", "array-contains", filters.reference);
    const result = await query.orderBy("at", "desc").limit(limit).get();
    return result.docs.map(doc => { const { expiresAt: _expiry, ...row } = doc.data(); return row as ShopLog; });
  }
  async countPostViews(shopId: string, postId: string, from: string, to: string): Promise<number> {
    const earliest = new Date(Math.max(Date.parse(from), Date.now() - logRetentionDays * 86400000)).toISOString();
    if (this.memory) return [...this.shopLogs.values()].filter(row => row.shopId === shopId && row.kind === "page_view" && row.postId === postId && row.at >= earliest && row.at <= to).length;
    const result = await this.firestore!.collection("gemihub_shop_logs").doc(shopId).collection("gemihub_log_events").where("postId", "==", postId).where("at", ">=", earliest).where("at", "<=", to).count().get();
    return result.data().count;
  }
  async countPostVisitors(shopId: string, postId: string, from: string, to: string): Promise<number> {
    const earliest = new Date(Math.max(Date.parse(from), Date.now() - logRetentionDays * 86400000)).toISOString();
    if (this.memory) return [...this.articleVisitors.values()].filter(row => row.shopId === shopId && row.postId === postId && row.at >= earliest && row.at <= to).length;
    const result = await this.firestore!.collection("gemihub_shop_logs").doc(shopId).collection("article_audiences").doc(postId).collection("gemihub_article_visitors").where("lastSeenAt", ">=", new Date(earliest)).where("lastSeenAt", "<=", new Date(to)).count().get();
    return result.data().count;
  }
  async countDailyTraffic(shopId: string, day: string) {
    if (this.memory) return { date: day, views: [...this.shopLogs.values()].filter(row => row.shopId === shopId && row.kind === "page_view" && row.day === day).length, uniqueBrowsers: [...this.dailyVisitors].filter(key => key.startsWith(`${shopId}:${day}:`)).length };
    const shopRef = this.firestore!.collection("gemihub_shop_logs").doc(shopId);
    const [views, visitors] = await Promise.all([shopRef.collection("gemihub_log_events").where("day", "==", day).count().get(), shopRef.collection("daily_audiences").doc(day).collection("gemihub_daily_visitors").count().get()]);
    return { date: day, views: views.data().count, uniqueBrowsers: visitors.data().count };
  }
  private ref(kind: string, id: string) {
    return this.firestore!.collection("gemihub_state").doc(this.key(kind, id));
  }
  async get<T>(kind: string, id: string): Promise<T | undefined> {
    this.activeLocks();
    const pending = this.batch
      .getStore()
      ?.findLast((e) => e.kind === kind && e.id === id);
    if (pending) return structuredClone(pending.value) as T;
    if (this.memory)
      return structuredClone(this.values.get(this.key(kind, id))?.value) as
        T | undefined;
    const doc = await this.ref(kind, id).get();
    return doc.exists ? JSON.parse(doc.get("json")) : undefined;
  }
  async take<T>(kind: string, id: string): Promise<T | undefined> {
    const leases = this.activeLocks();
    if (businessKinds.has(kind)) throw new Error(tr("業務記録は消費できません"));
    if (this.memory) {
      const key = this.key(kind, id);
      const value = this.values.get(key)?.value;
      this.values.delete(key);
      return structuredClone(value) as T | undefined;
    }
    const ref = this.ref(kind, id);
    return this.firestore!.runTransaction(async (tx) => {
      await assertLocks(tx, leases);
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      tx.delete(ref);
      return JSON.parse(doc.get("json")) as T;
    });
  }
  async put(kind: string, id: string, value: unknown): Promise<void> {
    this.activeLocks();
    const recordShop = businessKinds.has(kind) ? await this.get<Shop>("shop", (value as { shopId: string }).shopId) : undefined;
    if (recordShop && isArchivedShop(recordShop)) throw Object.assign(new Error(tr("お店がありません")), { status: 404 });
    const entry = { kind, id, value: structuredClone(value) };
    if (this.batch.getStore()) {
      this.batch.getStore()!.push(entry);
      return;
    }
    await this.persist([entry]);
  }
  private async persist(entries: Entry[]) {
    const leases = this.activeLocks();
    if (this.memory) {
      for (const e of entries) this.values.set(this.key(e.kind, e.id), e);
      return;
    }
    if (!entries.length) return;
    const write = (set: (ref: import("@google-cloud/firestore").DocumentReference, value: Record<string, unknown>) => unknown) => {
      for (const e of entries) set(this.ref(e.kind, e.id), {
        kind: e.kind,
        id: e.id,
        ...(typeof (e.value as { shopId?: unknown })?.shopId === "string" ? { scope: `${e.kind}:${(e.value as { shopId: string }).shopId}` } : {}),
        json: JSON.stringify(e.value),
      });
    };
    if (leases.length) {
      await this.firestore!.runTransaction(async tx => {
        await assertLocks(tx, leases);
        write((ref, value) => tx.set(ref, value));
      });
    } else {
      const batch = this.firestore!.batch();
      write((ref, value) => batch.set(ref, value));
      await batch.commit();
    }
  }
  async delete(kind: string, id: string) {
    const leases = this.activeLocks();
    if (businessKinds.has(kind))
      throw new Error(tr("お店の記録は状態変更で保持してください"));
    if (this.memory) this.values.delete(this.key(kind, id));
    else if (leases.length) await this.firestore!.runTransaction(async tx => {
      await assertLocks(tx, leases);
      tx.delete(this.ref(kind, id));
    });
    else await this.ref(kind, id).delete();
  }
  private pending<T>(kind: string, rows: { id: string; value: T }[], shopId?: string): T[] {
    const merged = new Map(rows.map(row => [row.id, row.value]));
    for (const entry of this.batch.getStore() || []) {
      if (entry.kind === kind && (!shopId || (entry.value as { shopId?: string }).shopId === shopId))
        merged.set(entry.id, structuredClone(entry.value) as T);
    }
    return [...merged.values()];
  }
  async records<T>(kind: string, shop: Shop): Promise<T[]> {
    this.activeLocks();
    if (isArchivedShop(shop)) return [];
    const rows = this.memory
      ? [...this.values.values()].filter(entry => entry.kind === kind && (entry.value as { shopId?: string }).shopId === shop.id).map(entry => ({ id: entry.id, value: structuredClone(entry.value) as T }))
      : (await this.firestore!.collection("gemihub_state").where("scope", "==", `${kind}:${shop.id}`).get()).docs.map(doc => ({ id: doc.get("id") as string, value: JSON.parse(doc.get("json")) as T }));
    return this.pending(kind, rows, shop.id);
  }
  async entries<T>(kind: string, shop?: Shop): Promise<{ id: string; value: T }[]> {
    this.activeLocks();
    if (businessKinds.has(kind)) throw new Error(tr("業務記録には専用の読み取りを使ってください"));
    if (shop && isArchivedShop(shop)) return [];
    if (this.memory) return [...this.values.values()].filter(entry => entry.kind === kind && (!shop || (entry.value as { shopId?: string }).shopId === shop.id)).map(entry => ({ id: entry.id, value: structuredClone(entry.value) as T }));
    const result = await this.firestore!.collection("gemihub_state").where(shop ? "scope" : "kind", "==", shop ? `${kind}:${shop.id}` : kind).get();
    return result.docs.map(doc => ({ id: doc.get("id") as string, value: JSON.parse(doc.get("json")) as T }));
  }
  async list<T>(kind: string): Promise<T[]> {
    this.activeLocks();
    const rows = this.memory
      ? [...this.values.values()].filter(entry => entry.kind === kind).map(entry => ({ id: entry.id, value: structuredClone(entry.value) as T }))
      : (await this.firestore!.collection("gemihub_state").where("kind", "==", kind).get()).docs.map(doc => ({ id: doc.get("id") as string, value: JSON.parse(doc.get("json")) as T }));
    const values = this.pending(kind, rows);
    if (!businessKinds.has(kind)) return values;
    const active = new Set((await this.list<Shop>("shop")).filter(shop => !isArchivedShop(shop)).map(shop => shop.id));
    return values.filter(value => active.has((value as { shopId: string }).shopId));
  }
  // Business records and operational state commit together; failed batches leave both unchanged.
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.activeLocks();
    if (this.batch.getStore()) return fn();
    const entries: Entry[] = [];
    const commit = { actions: [] as (() => void)[], status: "pending" as "pending" | "committed" | "failed" };
    return this.commitActions.run(commit, () => this.batch.run(entries, async () => {
      try {
        const result = await fn();
        await this.persist(entries);
        commit.status = "committed";
        for (const action of commit.actions) action();
        return result;
      } catch (error) { if (commit.status === "pending") commit.status = "failed"; throw error; }
    }));
  }
  afterCommit(action: () => void) {
    const commit = this.commitActions.getStore();
    if (!commit || commit.status === "committed") action();
    else if (commit.status === "pending") commit.actions.push(action);
  }
  async cleanup() {
    for (const kind of ["session", "oauth", "ticket", "emailLogin", "emailLoginLimit", "visual", "imageGenerationData", "settingsAiProposal", "inquiryQuota"]) {
      const entries = this.memory
        ? [...this.values.values()].filter((e) => e.kind === kind)
        : (
            await this.firestore!.collection("gemihub_state")
              .where("kind", "==", kind)
              .get()
          ).docs.map((d) => ({
            kind,
            id: d.get("id"),
            value: JSON.parse(d.get("json")),
          }));
      for (const entry of entries) {
        const v = entry.value as { expires?: number; createdAt?: number };
        if (
          (v.expires && v.expires < Date.now()) ||
          (kind === "visual" && (v.createdAt || 0) < Date.now() - 1800000)
        )
          await this.delete(kind, entry.id);
      }
    }
  }
  /** The shop's storage token; judge shops also use the operator's demo connection for Calendar. */
  async ownerToken(shop: Shop) {
    if (isArchivedShop(shop)) return undefined;
    if (shop.judge) return judgeActive() ? (await this.get<DemoGoogle>("demoGoogle", "current"))?.refreshToken : undefined;
    return (await this.get<User>("user", shop.owner))?.refreshToken;
  }
  async shop(id: string) {
    const shop = await this.get<Shop>("shop", id);
    return shop && !isArchivedShop(shop) ? shop : undefined;
  }
  async saveShop(shop: Shop) {
    await this.put("shop", shop.id, shop);
  }
  async bookings(shop: string): Promise<Booking[]> {
    const s = await this.shop(shop);
    if (!s) return [];
    const bookings = await this.records<Booking>("booking", s);
    // Captured amounts, consent and cancellation intent come from the payment journal.
    for (const c of (await this.records<Checkout>("checkout", s)).filter(c => c.phase === "confirmed")) {
      const index = bookings.findIndex(b => b.id === c.booking.id);
      if (index < 0) bookings.push(c.booking); else bookings[index] = c.booking;
    }
    return bookings;
  }
  async saveBooking(b: Booking) {
    await this.put("booking", b.id, b);
  }
  async createShop(owner: string, regionDefault?: import("../shared/region.ts").Region) {
    return this.locked(`owner:${owner}`, async () => {
      const existing = (await this.list<Shop>("shop")).find(
        (s) => s.owner === owner && !isArchivedShop(s),
      );
      if (existing) return existing;
      const id = randomUUID();
      const shop: Shop = {
        id,
        owner,
        slug: `shop-${id.slice(0, 8)}`,
        published: null,
        draft: null,
        revision: 0,
        history: [],
        ...(regionDefault && regionDefault.country !== "JP" ? { regionDefault } : {}),
      };
      await this.saveShop(shop);
      return shop;
    });
  }
  async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const parents = this.activeLocks();
    const previous = this.localLocks.get(id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        assertLocalLocks(parents);
        if (this.memory) return fn();
        const ref = this.firestore!.collection("gemihub_locks").doc(
          this.key("lock", id),
        );
        let lease: LockLease | undefined;
        for (let attempt = 0; attempt < 40; attempt++) {
          lease = await acquireLock(this.firestore!, ref, id);
          if (lease) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!lease)
          throw Object.assign(
            new Error(tr("別の操作を処理中です。少し待って再試行してください")),
            { status: 503 },
          );
        const held = lease;
        let renewal = Promise.resolve();
        const timer = setInterval(() => {
          renewal = renewal.then(async () => {
            if (held.lost) return;
            try { await renewLock(this.firestore!, held); }
            catch (error) { held.lost = true; console.error("Lock renewal failed", error); }
          });
        }, lockRenewMs);
        timer.unref();
        try {
          const result = await this.leases.run([...parents, held], fn);
          if (held.lost) throw lockLost();
          return result;
        } finally {
          clearInterval(timer);
          await renewal;
          await releaseLock(this.firestore!, held);
        }
      });
    this.localLocks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.localLocks.get(id) === next) this.localLocks.delete(id);
    }
  }
  async close() {
    // HTTP responses can finish before finally releases their lock, and the
    // reconciliation timer also owns locks without an HTTP connection.
    return this.closing ??= (async () => {
      while (this.localLocks.size)
        await Promise.allSettled([...this.localLocks.values()]);
      while (this.logWrites.size) await Promise.allSettled([...this.logWrites]);
      await this.firestore?.terminate();
    })();
  }
}
