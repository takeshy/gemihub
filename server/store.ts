import { tr } from "../shared/i18n.ts";
import { Firestore } from "@google-cloud/firestore";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import type { Checkout } from "./payments.ts";
import type { ShopConfig, Booking } from "./domain.ts";
import { judgeActive, type DemoGoogle } from "./judge.ts";
export type Shop = {
  id: string;
  owner: string;
  slug: string;
  published: ShopConfig | null;
  publication?: "provisional" | "public";
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
  domain?: string;
  domainToken?: string;
  domainVerified?: boolean;
  /** Reset shops remain as audit records, but are never served or synchronized. */
  archivedAt?: string;
  /** Present on shops created through hackathon judge access; stored in the operator's demo Google Drive. */
  judge?: { createdAt: string; folderId?: string; archivedAt?: string };
  /** Region chosen from the owner's first visit, used for the first proposal. */
  regionDefault?: import("../shared/region.ts").Region;
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

const chatKinds = new Set(["shopChat", "shopChatMessage"]);
const businessKinds = new Set(["booking", "inquiry", "member", "post", "customer", "customerNote", ...chatKinds]);
type Entry = { kind: string; id: string; value: unknown };
export class Store {
  readonly memory: boolean;
  private firestore?: Firestore;
  private values = new Map<string, Entry>();
  private batch = new AsyncLocalStorage<Entry[]>();
  private localLocks = new Map<string, Promise<unknown>>();
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
  private ref(kind: string, id: string) {
    return this.firestore!.collection("gemihub_state").doc(this.key(kind, id));
  }
  async get<T>(kind: string, id: string): Promise<T | undefined> {
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
    if (businessKinds.has(kind)) throw new Error(tr("業務記録は消費できません"));
    if (this.memory) {
      const key = this.key(kind, id);
      const value = this.values.get(key)?.value;
      this.values.delete(key);
      return structuredClone(value) as T | undefined;
    }
    const ref = this.ref(kind, id);
    return this.firestore!.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      tx.delete(ref);
      return JSON.parse(doc.get("json")) as T;
    });
  }
  async put(kind: string, id: string, value: unknown): Promise<void> {
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
    if (this.memory) {
      for (const e of entries) this.values.set(this.key(e.kind, e.id), e);
      return;
    }
    if (!entries.length) return;
    const batch = this.firestore!.batch();
    for (const e of entries)
      batch.set(this.ref(e.kind, e.id), {
        kind: e.kind,
        id: e.id,
        ...(typeof (e.value as { shopId?: unknown })?.shopId === "string" ? { scope: `${e.kind}:${(e.value as { shopId: string }).shopId}` } : {}),
        json: JSON.stringify(e.value),
      });
    await batch.commit();
  }
  async delete(kind: string, id: string) {
    if (businessKinds.has(kind))
      throw new Error(tr("お店の記録は状態変更で保持してください"));
    if (this.memory) this.values.delete(this.key(kind, id));
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
    if (isArchivedShop(shop)) return [];
    const rows = this.memory
      ? [...this.values.values()].filter(entry => entry.kind === kind && (entry.value as { shopId?: string }).shopId === shop.id).map(entry => ({ id: entry.id, value: structuredClone(entry.value) as T }))
      : (await this.firestore!.collection("gemihub_state").where("scope", "==", `${kind}:${shop.id}`).get()).docs.map(doc => ({ id: doc.get("id") as string, value: JSON.parse(doc.get("json")) as T }));
    return this.pending(kind, rows, shop.id);
  }
  async entries<T>(kind: string, shop?: Shop): Promise<{ id: string; value: T }[]> {
    if (businessKinds.has(kind)) throw new Error(tr("業務記録には専用の読み取りを使ってください"));
    if (shop && isArchivedShop(shop)) return [];
    if (this.memory) return [...this.values.values()].filter(entry => entry.kind === kind && (!shop || (entry.value as { shopId?: string }).shopId === shop.id)).map(entry => ({ id: entry.id, value: structuredClone(entry.value) as T }));
    const result = await this.firestore!.collection("gemihub_state").where(shop ? "scope" : "kind", "==", shop ? `${kind}:${shop.id}` : kind).get();
    return result.docs.map(doc => ({ id: doc.get("id") as string, value: JSON.parse(doc.get("json")) as T }));
  }
  async list<T>(kind: string): Promise<T[]> {
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
    if (this.batch.getStore()) return fn();
    const entries: Entry[] = [];
    return this.batch.run(entries, async () => {
      const result = await fn();
      await this.persist(entries);
      return result;
    });
  }
  async cleanup() {
    for (const kind of ["session", "oauth", "ticket", "emailLogin", "emailLoginLimit", "visual", "imageGenerationData", "settingsAiProposal"]) {
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
    for (const c of (await this.list<Checkout>("checkout")).filter(c => c.shopId === shop && c.phase === "confirmed")) {
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
    const previous = this.localLocks.get(id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        if (this.memory) return fn();
        const ref = this.firestore!.collection("gemihub_locks").doc(
          this.key("lock", id),
        );
        let acquired = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            await ref.create({ shopId: id, at: new Date().toISOString() });
            acquired = true;
            break;
          } catch (e) {
            if ((e as { code: number }).code !== 6) throw e;
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        if (!acquired)
          throw Object.assign(
            new Error(tr("別の操作を処理中です。少し待って再試行してください")),
            { status: 503 },
          );
        // No lease timeout: a paused process must never overlap a new writer.
        // After a crash, an operator verifies the process is stopped before deleting the lock.
        try {
          return await fn();
        } finally {
          await ref.delete();
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
    await this.firestore?.terminate();
  }
}
