import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Firestore } from "@google-cloud/firestore";
import { google } from "googleapis";
import { Store, type Shop } from "../server/store.ts";
import { encrypt } from "../server/google.ts";
import { sample, type Booking } from "../server/domain.ts";
import type { CustomerNote, CustomerRecord } from "../server/customers.ts";
import { randomUUID } from "node:crypto";
import { createConversation, appendChatMessage, readConversation, type ShopChatMessage } from "../server/shop-chat.ts";

test("Firestore shares operational state and locks; owner Sheets hold business records, survive restart, and reflect revocation", async (t) => {
  const previous = {
    demo: process.env.DEMO_MODE,
    project: process.env.GOOGLE_CLOUD_PROJECT,
  };
  process.env.DEMO_MODE = "false";
  process.env.GOOGLE_CLOUD_PROJECT = "fixture";
  t.after(() => {
    if (previous.demo === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous.demo;
    if (previous.project === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previous.project;
    mock.restoreAll();
  });
  const cloud = new Map<string, Record<string, unknown>>();
  function ref(path: string): any {
    return {
      path,
      async get() {
        const value = cloud.get(path);
        return { exists: !!value, get: (k: string) => value?.[k] };
      },
      async create(value: Record<string, unknown>) {
        if (cloud.has(path))
          throw Object.assign(new Error("exists"), { code: 6 });
        cloud.set(path, value);
      },
      async delete() {
        cloud.delete(path);
      },
    };
  }
  mock.method(Firestore.prototype, "collection", ((name: string) => ({
    doc: (id: string) => ref(name + "/" + id),
    where: (_key: string, _op: string, kind: string) => ({
      get: async () => ({
        docs: [...cloud.entries()]
          .filter(([path, v]) => path.startsWith(name + "/") && v.kind === kind)
          .map(([, v]) => ({ get: (k: string) => v[k] })),
      }),
    }),
  })) as any);
  mock.method(Firestore.prototype, "batch", (() => {
    const changes: [{ path: string }, Record<string, unknown>][] = [];
    return {
      set: (r: { path: string }, v: Record<string, unknown>) =>
        changes.push([r, v]),
      commit: async () => {
        for (const [r, v] of changes) cloud.set(r.path, v);
      },
    };
  }) as any);
  let transactions = Promise.resolve();
  mock.method(Firestore.prototype, "runTransaction", ((fn: any) => {
    const result = transactions.then(() =>
      fn({
        get: (r: any) => r.get(),
        delete: (r: any) => cloud.delete(r.path),
      }),
    );
    transactions = result.then(
      () => {},
      () => {},
    );
    return result;
  }) as any);
  mock.method(Firestore.prototype, "terminate", async () => {});
  const sheets = new Map<string, unknown[][]>();
  let failChatWrite = false;
  const fake = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [...sheets.keys()].map((title) => ({
            properties: { title },
          })),
        },
      }),
      batchUpdate: async ({ requestBody }: any) => {
        for (const r of requestBody.requests)
          sheets.set(r.addSheet.properties.title, []);
      },
      values: {
        get: async ({ range }: any) => ({
          data: {
            values: structuredClone(sheets.get(range.split("!")[0]) || []),
          },
        }),
        update: async ({ range, requestBody, valueInputOption }: any) => {
          assert.equal(valueInputOption, "RAW");
          const [name, cell] = range.split("!");
          if (name === "ai_chat_messages" && failChatWrite) { failChatWrite = false; throw new Error("fixture chat write interrupted"); }
          const rows = sheets.get(name)!;
          rows[Number(cell.slice(1)) - 1] = structuredClone(
            requestBody.values[0],
          );
        },
      },
    },
  };
  mock.method(google, "sheets", (() => fake) as any);
  const first = new Store();
  const second = new Store();
  const shop = await first.createShop("owner@example.com");
  shop.google = {
    sheetId: "owner-sheet",
    folderId: "owner-folder",
    specId: "spec",
    historyId: "history",
  };
  shop.published = sample;
  await first.saveShop(shop);
  await first.put("user", shop.owner, {
    email: shop.owner,
    name: "owner",
    role: "owner",
    refreshToken: encrypt("token"),
  });
  assert.equal((await second.shop(shop.id))?.owner, shop.owner);
  await first.put("ticket", "single-use", { expires: Date.now() + 10000 });
  const consumed = await Promise.all([
    first.take("ticket", "single-use"),
    second.take("ticket", "single-use"),
  ]);
  assert.equal(consumed.filter(Boolean).length, 1);
  const sameOwner = await Promise.all([
    first.createShop("unique@example.com"),
    second.createShop("unique@example.com"),
  ]);
  assert.equal(sameOwner[0].id, sameOwner[1].id);

  const booking: Booking = {
    id: "booking1",
    shopId: shop.id,
    customer: "customer@example.com",
    name: "お客様",
    menuId: "simple",
    staffId: "a",
    start: "2026-11-01T01:00:00Z",
    end: "2026-11-01T02:00:00Z",
    status: "active",
    createdAt: new Date().toISOString(),
    requestKey: "stable-request",
    price: 5500, message: "相談したいです。",
  };
  let active = 0,
    max = 0;
  await Promise.all(
    [first, second].map((store, index) =>
      store.locked(shop.id, async () => {
        max = Math.max(max, ++active);
        const existing = await store.bookings(shop.id);
        if (!existing.length) {
          await new Promise((r) => setTimeout(r, 20));
          await store.saveBooking(booking);
        }
        active--;
      }),
    ),
  );
  assert.equal(max, 1);
  assert.equal((await second.bookings(shop.id)).length, 1);
  const restarted = new Store();
  assert.equal(
    (await restarted.bookings(shop.id))[0].requestKey,
    "stable-request",
  );
  await restarted.saveBooking({ ...booking, status: "cancelled" });
  assert.equal((await first.bookings(shop.id))[0].status, "cancelled");
  assert.equal(sheets.get("reservations")?.length, 2);
  assert.equal((await restarted.bookings(shop.id))[0].price, 5500);
  const reservations = sheets.get("reservations")!;
  // Missing or malformed fees must never silently reduce CRM totals.
  for (const invalid of ["", " ", -1, "not-a-price", 1.5]) {
    reservations[1][12] = invalid;
    await assert.rejects(() => restarted.bookings(shop.id), /料金/);
  }
  reservations[1][12] = 0;
  assert.equal((await restarted.bookings(shop.id))[0].price, 0);
  reservations[1][12] = booking.price;
  sheets.set("customers", [["email", "updatedBy", "updatedAt"], ["legacy@example.com", shop.owner, "2026-10-01T00:00:00Z"]]);
  await first.put("customer", `${shop.id}:customer@example.com`, {
    shopId: shop.id, email: "customer@example.com", updatedBy: shop.owner, updatedAt: "2026-11-01T00:00:00Z", name: "登録した名前", birthDate: "1990-01-02", gender: "not_specified",
  });
  assert.deepEqual(sheets.get("customers")![0], ["email", "updatedBy", "updatedAt", "name", "birthDate", "gender"]);
  assert.equal((await restarted.get<CustomerRecord>("customer", `${shop.id}:customer@example.com`))?.email, "customer@example.com");
  assert.equal((await restarted.get<CustomerRecord>("customer", `${shop.id}:customer@example.com`))?.birthDate, "1990-01-02");
  assert.equal((await restarted.get<CustomerRecord>("customer", `${shop.id}:legacy@example.com`))?.email, "legacy@example.com", "appending profile columns preserves older customer rows");
  const note: CustomerNote = { id: "n1", shopId: shop.id, email: "customer@example.com", text: "=private note", attachments: [{id: "private-file", name: "写真.png", mimeType: "image/png", size: 3}], createdBy: shop.owner, createdAt: "2026-11-01T00:00:00Z", updatedBy: shop.owner, updatedAt: "2026-11-01T00:00:00Z", status: "active" };
  await first.put("customerNote", note.id, note);
  assert.deepEqual((await restarted.records<CustomerNote>("customerNote", shop))[0], note);
  await second.put("customerNote", note.id, { ...note, status: "deleted" });
  assert.equal((await first.records<CustomerNote>("customerNote", shop))[0].status, "deleted");
  assert.equal(sheets.get("customer_notes")!.length, 2);
  await assert.rejects(() => first.delete("customerNote", note.id), /状態変更/);
  await assert.rejects(() => first.delete("customer", `${shop.id}:customer@example.com`), /状態変更/);
  assert.equal((await restarted.bookings(shop.id))[0].message, "相談したいです。");
  await first.put("member", `${shop.id}:guest@example.com`, {
    shopId: shop.id,
    email: "guest@example.com",
    accepted: true,
    status: "accepted",
  });
  assert.equal(
    (
      await second.get<{ accepted: boolean }>(
        "member",
        `${shop.id}:guest@example.com`,
      )
    )?.accepted,
    true,
  );
  const memberRows = sheets.get("members")!;
  memberRows[1][2] = "revoked";
  assert.equal(
    (
      await second.get<{ accepted: boolean }>(
        "member",
        `${shop.id}:guest@example.com`,
      )
    )?.accepted,
    false,
  );
  await first.put("inquiry", "q1", {
    id: "q1",
    shopId: shop.id,
    email: "customer@example.com",
    name: "お客様",
    message: "問い合わせ",
    status: "open",
    at: "now",
  });
  assert.equal(
    (await restarted.records<{ message: string }>("inquiry", shop))[0].message,
    "問い合わせ",
  );
  assert.ok(
    [...cloud.values()].every(
      (v) => !["booking", "member", "inquiry", "post", "customer", "customerNote"].includes(String(v.kind)),
    ),
  );
  const destination = shop.google;
  delete shop.google;
  await first.saveShop(shop);
  const conversation = await createConversation(first,shop,shop.owner,"modify",randomUUID());
  await appendChatMessage(first,shop,conversation,{role:"user",text:"公開前から残す相談",requestId:randomUUID()});
  assert.equal((await readConversation(restarted,shop,shop.owner,conversation.id)).messages.length,1,"unpublished chats survive process restarts in Firestore");
  shop.google=destination;await first.saveShop(shop);
  const migrated=await readConversation(restarted,shop,shop.owner,conversation.id);
  assert.equal(migrated.messages[0].text,"公開前から残す相談");
  assert.equal(sheets.get("ai_chats")![1][0],conversation.id);
  assert.equal(sheets.get("ai_chat_messages")!.length,2);
  const interrupted:ShopChatMessage={...migrated.messages[0],id:randomUUID(),text:"連携が中断しても失わない会話",requestId:randomUUID(),sequence:2,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  failChatWrite=true;await assert.rejects(()=>first.put("shopChatMessage",interrupted.id,interrupted),/interrupted/);
  const recovered=await readConversation(new Store(),shop,shop.owner,conversation.id);
  assert.deepEqual(recovered.messages.map(message=>message.text),["公開前から残す相談","連携が中断しても失わない会話"]);
  assert.ok([...cloud.values()].every(value=>!["shopChat","shopChatMessage"].includes(String(value.kind))),"successful migration clears the operational staging copy");
  const headers = sheets.get("reservations")![0];
  headers[0] = "broken";
  await assert.rejects(() => first.bookings(shop.id), /列構造/);
  assert.ok([...cloud.keys()].every((k) => !k.startsWith("omaiweb_locks/")));
});
