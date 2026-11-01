import { Firestore } from "@google-cloud/firestore";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import type { ShopConfig, Booking } from "./domain.ts";
import { readRecords, writeRecord } from "./sheet-records.ts";
export type Shop = {
  id: string;
  owner: string;
  slug: string;
  published: ShopConfig | null;
  draft: ShopConfig | null;
  revision: number;
  history: { at: string; summary: string }[];
  google?: {
    sheetId: string;
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
};
export type User = {
  email: string;
  name: string;
  shopId?: string;
  role: "owner" | "customer";
  refreshToken?: string;
};

const businessKinds = new Set(["booking", "inquiry", "member", "post", "customer", "customerNote"]);
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
        "ファイル保存は廃止しました。Firestore を設定してください",
      );
    if (!this.memory) {
      if (!process.env.GOOGLE_CLOUD_PROJECT)
        throw new Error("GOOGLE_CLOUD_PROJECT is required for Firestore");
      this.firestore = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
      });
    }
  }
  private key(kind: string, id: string) {
    return createHash("sha256")
      .update(kind + ":" + id)
      .digest("hex");
  }
  private ref(kind: string, id: string) {
    return this.firestore!.collection("omaiweb_state").doc(this.key(kind, id));
  }
  async get<T>(kind: string, id: string): Promise<T | undefined> {
    if (!this.memory && businessKinds.has(kind)) {
      if (kind === "member" || kind === "customer") {
        const shop = await this.shop(id.split(":")[0]);
        return shop
          ? (await this.records<T & { email: string }>(kind, shop)).find(
              (v) => `${shop.id}:${v.email}` === id,
            )
          : undefined;
      }
      return (await this.list<T & { id: string }>(kind)).find(
        (v) => v.id === id,
      );
    }
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
    if (businessKinds.has(kind)) throw new Error("業務記録は消費できません");
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
    if (!this.memory && businessKinds.has(kind)) {
      const shop = await this.shop((value as { shopId: string }).shopId);
      if (!shop?.google)
        throw Object.assign(
          new Error("先にお店を公開して保存先を作成してください"),
          { status: 409 },
        );
      const token = (await this.get<User>("user", shop.owner))?.refreshToken;
      if (!token) throw new Error("店主の Google 再接続が必要です");
      await writeRecord(
        shop,
        kind,
        id,
        value as Record<string, unknown>,
        token,
      );
      return;
    }
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
        json: JSON.stringify(e.value),
      });
    await batch.commit();
  }
  async delete(kind: string, id: string) {
    if (businessKinds.has(kind))
      throw new Error("お店の記録は状態変更で保持してください");
    if (this.memory) this.values.delete(this.key(kind, id));
    else await this.ref(kind, id).delete();
  }
  async records<T>(kind: string, shop: Shop): Promise<T[]> {
    if (this.memory)
      return (await this.list<T & { shopId: string }>(kind)).filter(
        (v) => v.shopId === shop.id,
      );
    if (!shop.google) return [];
    const token = (await this.get<User>("user", shop.owner))?.refreshToken;
    if (!token)
      throw Object.assign(new Error("店主の Google 再接続が必要です"), {
        status: 503,
      });
    return (await readRecords(shop, kind, token)) as T[];
  }
  async list<T>(kind: string): Promise<T[]> {
    if (!this.memory && businessKinds.has(kind))
      return (
        await Promise.all(
          (await this.list<Shop>("shop")).map((s) => this.records<T>(kind, s)),
        )
      ).flat();
    if (this.memory)
      return [...this.values.values()]
        .filter((e) => e.kind === kind)
        .map((e) => structuredClone(e.value) as T);
    const result = await this.firestore!.collection("omaiweb_state")
      .where("kind", "==", kind)
      .get();
    return result.docs.map((d) => JSON.parse(d.get("json")));
  }
  // Atomic operational writes. Sheets writes are acknowledged before these commit;
  // request identities in the sheet make an interrupted commit safe to retry.
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
    for (const kind of ["session", "oauth", "ticket", "visual"]) {
      const entries = this.memory
        ? [...this.values.values()].filter((e) => e.kind === kind)
        : (
            await this.firestore!.collection("omaiweb_state")
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
  async shop(id: string) {
    return this.get<Shop>("shop", id);
  }
  async saveShop(shop: Shop) {
    await this.put("shop", shop.id, shop);
  }
  async bookings(shop: string): Promise<Booking[]> {
    const s = await this.shop(shop);
    return s ? this.records<Booking>("booking", s) : [];
  }
  async saveBooking(b: Booking) {
    await this.put("booking", b.id, b);
  }
  async createShop(owner: string) {
    return this.locked(`owner:${owner}`, async () => {
      const existing = (await this.list<Shop>("shop")).find(
        (s) => s.owner === owner,
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
        const ref = this.firestore!.collection("omaiweb_locks").doc(
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
            new Error("別の操作を処理中です。少し待って再試行してください"),
            { status: 503 },
          );
        // No lease timeout: a paused process must never overlap a new Sheets writer.
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
