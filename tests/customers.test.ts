import { createHash, randomUUID } from "node:crypto";
import { addCustomerNote } from "../server/customer-notes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { aggregateCustomers, customerSummaries, customerFilterSchema, customerSince, customerImages, type Inquiry, type CustomerNote, type CustomerDetail } from "../server/customers.ts";
import { createApp } from "../server/app.ts";
import { Store, type User } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample, type Booking } from "../server/domain.ts";

const now = new Date("2026-11-01T03:00:00Z");
const booking: Booking = {
  id: "first", shopId: "shop", customer: " Alice@Example.com ", name: "以前の氏名", menuId: "simple", staffId: "aoi", price: 5500, message: "",
  start: "2026-10-01T01:00:00Z", end: "2026-10-01T02:00:00Z", status: "active", createdAt: "2026-09-30T00:00:00Z",
};
const inquiry: Inquiry = {
  id: "question", shopId: "shop", email: " ALICE@example.COM ", name: "最新の氏名", message: "色の相談", reply: "ご相談ください", status: "replied", at: "2026-10-20T00:00:00Z",
};

const fixtureNote: CustomerNote = { id: "note", shopId: "shop", email: "alice@example.com", text: "お好み", attachments: [], createdAt: "2026-10-01T00:00:00Z", createdBy: "owner@example.com", updatedAt: "2026-10-01T00:00:00Z", updatedBy: "owner@example.com", status: "active" };

test("CRM period presets use JST dates and calendar months with month-end clamping", () => {
  const reference = new Date("2026-10-31T15:05:00Z"); // November 1 in JST.
  for (const [period, expected] of Object.entries({ week: "2026-10-25", month: "2026-10-01", quarter: "2026-08-01", "half-year": "2026-05-01", year: "2025-11-01" })) {
    assert.equal(customerSince(customerFilterSchema.parse({ period }), reference), expected);
  }
  assert.equal(customerSince(customerFilterSchema.parse({}), reference), undefined);
  assert.equal(customerSince(customerFilterSchema.parse({ period: "custom", since: "2020-01-01" }), reference), "2020-01-01");
  for (const [period, referenceDate, expected] of [
    ["month", "2026-03-31T03:00:00Z", "2026-02-28"],
    ["month", "2024-03-31T03:00:00Z", "2024-02-29"],
    ["quarter", "2026-05-31T03:00:00Z", "2026-02-28"],
    ["half-year", "2026-08-31T03:00:00Z", "2026-02-28"],
    ["year", "2024-02-29T03:00:00Z", "2023-02-28"],
  ]) assert.equal(customerSince(customerFilterSchema.parse({ period }), new Date(referenceDate)), expected);
  for (const input of [{ period: "unknown" }, { period: "custom" }, { period: "custom", since: "2026-02-30" }, { period: "custom", since: "invalid" }]) {
    assert.equal(customerFilterSchema.safeParse(input).success, false);
  }
});

test("CRM filters visits, spending and history by inclusive JST start date, preserving future bookings, names and notes", () => {
  const bookings: Booking[] = [
    { ...booking, id: "before", start: "2026-10-01T14:59:59Z", end: "2026-10-01T15:59:59Z" },
    { ...booking, id: "boundary", start: "2026-10-01T15:00:00Z", end: "2026-10-01T16:00:00Z", price: 6000 },
    { ...booking, id: "after", start: "2026-10-03T01:00:00Z", end: "2026-10-03T02:00:00Z", price: 7000 },
    { ...booking, id: "cancelled", start: "2026-10-03T01:00:00Z", status: "cancelled" },
    { ...booking, id: "no-show", start: "2026-10-03T01:00:00Z", status: "no_show" },
    { ...booking, id: "future", start: "2026-12-01T01:00:00Z", end: "2026-12-01T02:00:00Z" },
    { ...booking, id: "old-only", customer: "old@example.com", start: "2025-01-01T00:00:00Z" },
  ];
  const inquiries = [
    { ...inquiry, id: "old-question", at: "2026-10-01T14:59:59Z" },
    { ...inquiry, id: "new-question", at: "2026-10-01T15:00:00Z" },
    { ...inquiry, id: "only-question", email: "only@example.com", at: "2026-10-02T03:00:00Z" },
  ];
  const record: CustomerNote = { ...fixtureNote, text: "共通メモ" };
  const customers = aggregateCustomers(bookings, inquiries, [record], now, "2026-10-02");
  const alice = customers.find(customer => customer.email === "alice@example.com")!;
  assert.equal(alice.visitCount, 2);
  assert.equal(alice.totalAmount, 13000);
  assert.equal(alice.lastVisit, "2026-10-03T01:00:00Z");
  assert.equal(alice.history.length, 6);
  assert.equal(alice.history[0].at, "2026-12-01T01:00:00Z");
  assert.equal(alice.name, "最新の氏名");
  assert.equal(alice.hasNote, true);
  assert.equal(alice.history.some(event => event.kind === "note"), false);
  assert.deepEqual(customerSummaries(customers).map(customer => customer.email), ["alice@example.com", "only@example.com"]);
  const future = aggregateCustomers(bookings, inquiries, [record], now, "2026-12-01").find(customer => customer.email === "alice@example.com")!;
  assert.equal(future.visitCount, 0);
  assert.equal(future.totalAmount, 0);
  assert.equal(future.lastVisit, null);
  assert.equal(future.history.length, 1);
  assert.equal(future.name, alice.name);
  assert.equal(future.hasNote, true);
  assert.deepEqual(customerSummaries(aggregateCustomers(bookings, inquiries, [record], now, "2027-01-01")), []);
});

test("CRM merges normalized emails, uses latest recorded name, and counts only ended active reservations at recorded prices", () => {
  const bookings: Booking[] = [
    booking,
    { ...booking, id: "second", customer: "alice@example.com", price: 7800, start: "2026-10-10T01:00:00Z", end: "2026-10-10T02:00:00Z" },
    { ...booking, id: "cancelled", status: "cancelled", price: 99999 },
    { ...booking, id: "no-show", status: "no_show", price: 99999 },
    { ...booking, id: "future", start: "2026-12-01T01:00:00Z", end: "2026-12-01T02:00:00Z", price: 99999 },
    { ...booking, id: "ongoing", start: "2026-11-01T02:30:00Z", end: "2026-11-01T03:30:00Z" },
  ];
  const inquiries = [inquiry, { ...inquiry, id: "only-inquiry", email: "only@example.com", name: "問い合わせのみ" }];
  const result = aggregateCustomers(bookings, inquiries, [], now);
  assert.equal(result.length, 2);
  const alice = result.find(customer => customer.email === "alice@example.com")!;
  assert.equal(alice.name, "最新の氏名");
  assert.equal(alice.visitCount, 2);
  assert.equal(alice.lastVisit, "2026-10-10T01:00:00Z");
  assert.equal(alice.totalAmount, 13300);
  assert.equal(alice.history.length, 7);
  assert.equal(alice.history[0].kind, "booking");
  assert.equal(alice.history[0].at, "2026-12-01T01:00:00Z");
  assert.ok(alice.history.some(event => event.kind === "inquiry" && event.inquiry.reply === inquiry.reply));
  const only = result.find(customer => customer.email === "only@example.com")!;
  assert.equal(only.visitCount, 0);
  assert.equal(only.lastVisit, null);
  assert.equal(only.totalAmount, 0);
  assert.deepEqual(result, aggregateCustomers([...bookings].reverse(), [...inquiries].reverse(), [], now));
  assert.equal("history" in customerSummaries(result)[0], false);
  assert.equal("note" in customerSummaries(result)[0], false);
});

test("CRM accepts zero prices and resolves same-time names independently of row order", () => {
  const bookings = [
    { ...booking, id: "a", price: 0, name: "A" },
    { ...booking, id: "z", price: 0, name: "Z", end: now.toISOString() },
  ];
  const record: CustomerNote = { ...fixtureNote, email: "ALICE@example.com" };
  const [customer] = aggregateCustomers(bookings, [], [record], now);
  assert.equal(customer.name, "Z");
  assert.equal(customer.visitCount, 2);
  assert.equal(customer.totalAmount, 0);
  assert.equal(customer.hasNote, true);
  assert.ok(customer.history.some(event => event.kind === "note" && event.note.text === record.text));
  assert.deepEqual([customer], aggregateCustomers([...bookings].reverse(), [], [record], now));
  assert.deepEqual(aggregateCustomers([], [], [record], now), []);
});

test("CRM API is scoped to operators and shop; notes persist, reject stale edits, and never enter public responses", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  await store.saveShop(shop);
  await store.saveBooking({ ...booking, shopId: shop.id });
  await store.put("inquiry", inquiry.id, { ...inquiry, shopId: shop.id });
  await store.put("inquiry", "only", { ...inquiry, id: "only", shopId: shop.id, email: "only@example.com" });
  const other = await store.createShop("other-owner@example.com");
  other.published = sample;
  await store.saveShop(other);
  await store.saveBooking({ ...booking, id: "other-booking", shopId: other.id, customer: "other-shop@example.com" });
  const sessions: Record<string, User> = {
    owner: { email: shop.owner, name: "店主", role: "owner" },
    customer: { email: "alice@example.com", name: "お客様", role: "customer", shopId: shop.id },
    staff: { email: "staff@example.com", name: "スタッフ", role: "customer" },
    invited: { email: "invited@example.com", name: "招待中", role: "customer" },
    revoked: { email: "revoked@example.com", name: "解除済み", role: "customer" },
    other: { email: other.owner, name: "別の店主", role: "owner" },
  };
  for (const [id, user] of Object.entries(sessions)) await store.put("session", digest(id), { user, expires: Date.now() + 600000 });
  for (const id of ["staff", "invited", "revoked"]) await store.put("member", `${shop.id}:${sessions[id].email}`, { shopId: shop.id, email: sessions[id].email, accepted: id === "staff", status: id === "staff" ? "accepted" : id });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  async function request(path: string, id = "owner", data?: unknown, signal?: AbortSignal) {
    const response = await fetch(origin + path, { signal, method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${id}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  const base = `/api/shops/${shop.id}/customers`;
  const profile = `${base}/alice%40example.com`;
  for (const query of ["?period=custom", "?period=custom&since=2026-02-30", "?period=unknown"]) assert.equal((await request(`${base}${query}`)).status, 400);
  const denied = ["customer", "invited", "revoked", "other", "anonymous"];
  const input = { requestId: randomUUID(), text: "秘密のお好みメモ", files: [{ name: "資料.txt", mimeType: "text/plain", data: Buffer.from("private file").toString("base64") }, { name: "登録時の髪型.png", mimeType: "image/png", data: Buffer.from("image bytes").toString("base64") }] };
  for (const id of denied) {
    assert.equal((await request(base, id)).status, 403);
    assert.equal((await request(profile, id)).status, 403);
    assert.equal((await request(`${profile}/images`, id)).status, 403);
    assert.equal((await request(`${profile}/notes`, id, input)).status, 403);
  }
  const list = await request(base);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 2);
  assert.ok(list.body.some((customer: CustomerDetail) => customer.email === "only@example.com"));
  assert.ok(!JSON.stringify(list.body).includes("other-shop@example.com"));
  assert.equal((await request(base, "staff")).status, 200);
  assert.equal((await request(`${base}/missing%40example.com`)).status, 404);
  for (const invalid of [
    { ...input, text: "x".repeat(10001) },
    { ...input, text: "", files: [] },
    { ...input, files: Array(6).fill(input.files[0]) },
    { ...input, files: [{ ...input.files[0], data: "??" }] },
    { ...input, files: [{ ...input.files[0], name: "bad\nname" }] },
    { ...input, files: [{ ...input.files[0], data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }] },
  ]) assert.equal((await request(`${profile}/notes`, "owner", invalid)).status, 400);
  const saved = await request(`${profile}/notes`, "owner", input);
  assert.equal(saved.status, 200);
  const reloaded = await request(profile, "staff");
  const note: CustomerNote = reloaded.body.history.find((event: any) => event.kind === "note").note;
  assert.equal(note.text, input.text);
  assert.equal(note.createdBy, shop.owner);
  const gallery = await request(`${profile}/images?period=custom&since=2099-01-01`);
  assert.equal(gallery.status, 200);
  assert.equal(gallery.body.images.length, 1);
  assert.equal(gallery.body.images[0].name, "登録時の髪型.png");
  assert.ok(!JSON.stringify(gallery.body).includes(input.text));
  assert.equal((await request(`${base}/only%40example.com/images`)).body.images.length, 0);
  assert.equal(reloaded.body.hasNote, true);
  assert.equal(reloaded.body.history.length, 3);
  assert.equal((await request(base)).body[0].hasNote, true);
  assert.equal((await store.records<CustomerNote>("customerNote", shop)).length, 1);
  assert.equal((await request(`${profile}/notes`, "owner", input)).status, 200);
  assert.equal((await store.records<CustomerNote>("customerNote", shop)).length, 1);
  assert.equal((await request(`${profile}/notes`, "owner", { ...input, text: "changed retry" })).status, 409);
  const notePath = `${profile}/notes/${note.id}`;
  const filePath = `${notePath}/files/${note.attachments[0].id}`;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const holding = store.locked(shop.id, async () => { entered(); await gate; });
  await started;
  try {
    for (const id of ["owner", "staff"]) for (const path of [base, profile, `${profile}/images`, filePath]) {
      assert.equal((await request(path, id, undefined, AbortSignal.timeout(2000))).status, 200, "CRM reads do not wait for the shop write lock");
    }
  } finally { release(); await holding; }
  assert.equal((await request(filePath, "staff")).body.data, input.files[0].data);
  assert.equal(note.attachments[0].sha256, createHash("sha256").update(Buffer.from(input.files[0].data, "base64")).digest("hex"));
  const storedFile = await store.get<Record<string, unknown>>("demoCustomerFile", note.attachments[0].id);
  await store.put("demoCustomerFile", note.attachments[0].id, { ...storedFile, data: Buffer.alloc(note.attachments[0].size, 0x78).toString("base64") });
  assert.equal((await request(filePath, "staff")).status, 409, "customer notes also reject same-size content changes");
  await store.put("demoCustomerFile", note.attachments[0].id, storedFile);
  assert.equal((await request(`${notePath}/files/missing`)).status, 404);
  assert.equal((await request(`${base}/only%40example.com/notes/${note.id}/files/${note.attachments[0].id}`)).status, 404);
  for (const id of denied) {
    assert.equal((await request(filePath, id)).status, 403);
    assert.equal((await request(notePath, id, { text: "bad", previousUpdatedAt: note.updatedAt })).status, 403);
    assert.equal((await request(`${notePath}/delete`, id, { previousUpdatedAt: note.updatedAt })).status, 403);
  }
  const edited = await request(notePath, "staff", { text: "更新したメモ", previousUpdatedAt: note.updatedAt });
  assert.equal(edited.status, 200);
  const editedNote: CustomerNote = edited.body.history.find((event: any) => event.kind === "note").note;
  assert.equal(editedNote.text, "更新したメモ");
  assert.equal(editedNote.updatedBy, sessions.staff.email);
  assert.deepEqual(editedNote.attachments, note.attachments);
  assert.equal((await request(notePath, "owner", { text: "stale", previousUpdatedAt: note.updatedAt })).status, 409);
  const image = note.attachments[1];
  for (const changes of [[{ id: "unknown", name: "new.png" }], [{ id: image.id, name: " " }], [{ id: image.id, name: "bad\nname" }], [{ id: image.id, name: "a.png" }, { id: image.id, name: "b.png" }]]) {
    assert.equal((await request(notePath, "staff", { attachmentNames: changes, previousUpdatedAt: editedNote.updatedAt })).status, 400);
  }
  const renamed = await request(notePath, "staff", { attachmentNames: [{ id: image.id, name: "ショートボブ.png" }], previousUpdatedAt: editedNote.updatedAt });
  assert.equal(renamed.status, 200);
  const renamedNote: CustomerNote = renamed.body.history.find((event: any) => event.kind === "note").note;
  assert.equal(renamedNote.text, editedNote.text);
  assert.deepEqual(renamedNote.attachments[1], { ...image, name: "ショートボブ.png" });
  assert.equal((await request(`${profile}/images`)).body.images[0].name, "ショートボブ.png");
  assert.equal((await store.get<{name: string}>("demoCustomerFile", image.id))!.name, "ショートボブ.png");
  assert.equal((await request(`${notePath}/files/${image.id}`)).body.data, input.files[1].data);
  assert.equal((await request(notePath, "owner", { attachmentNames: [{ id: image.id, name: "stale.png" }], previousUpdatedAt: editedNote.updatedAt })).status, 409);
  const range = "?period=custom&since=2026-10-20";
  const filtered = await request(`${profile}${range}`);
  assert.equal(filtered.body.visitCount, 0);
  assert.equal(filtered.body.totalAmount, 0);
  assert.equal(filtered.body.lastVisit, null);
  assert.ok(filtered.body.history.some((event: any) => event.kind === "inquiry"));
  assert.equal((await request(`${base}?period=custom&since=2099-01-01`)).body.length, 0);
  for (const path of [`/api/public/${shop.slug}`, `/api/public/${shop.slug}/bookings`, "/api/workspace"]) {
    const response = await request(path, "customer");
    assert.equal(response.status, 200);
    assert.ok(!JSON.stringify(response.body).includes("更新したメモ"));
    assert.ok(!JSON.stringify(response.body).includes("private file"));
    assert.ok(!JSON.stringify(response.body).includes("other-shop@example.com"));
    if (path === "/api/workspace") assert.deepEqual(response.body.shops, []);
  }
  const deleted = await request(`${notePath}/delete${range}`, "staff", { previousUpdatedAt: renamedNote.updatedAt });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.hasNote, false);
  assert.equal((await request(profile)).body.history.some((event: any) => event.kind === "note"), false);
  assert.equal((await request(filePath)).status, 404);
  assert.equal((await request(`${profile}/images`)).body.images.length, 0);
  assert.equal((await store.records<CustomerNote>("customerNote", shop))[0].status, "deleted");
  assert.equal((await store.records<CustomerNote>("customerNote", shop)).length, 1);
  assert.equal((await request(`${profile}/notes`, "owner", input)).status, 200);
  assert.equal((await request(profile)).body.hasNote, false);
  await store.put("member", `${shop.id}:${sessions.staff.email}`, { shopId: shop.id, email: sessions.staff.email, accepted: false, status: "revoked" });
  assert.equal((await request(base, "staff")).status, 403);
});

test("CRM attachment retry reuses journaled file IDs and never duplicates a note after an interrupted upload", async () => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  let reservations = 0;
  const uploaded: string[] = [];
  let interrupt = true;
  const files = {
    async reserve(count: number) { reservations++; return Array.from({length: count}, (_, index) => `reserved-${index}`); },
    async upload(_shop: any, _token: string, id: string) { uploaded.push(id); if (interrupt) { interrupt = false; throw new Error("connection interrupted after upload"); } },
    async read() { return Buffer.alloc(0); },
    async rename() {},
  };
  const input = { requestId: randomUUID(), text: "添付つき", files: [{ name: "note.txt", mimeType: "text/plain", data: "aGk=" }] };
  await assert.rejects(() => addCustomerNote(store, shop, "alice@example.com", shop.owner, input, files, "token"), /interrupted/);
  assert.equal((await store.records<CustomerNote>("customerNote", shop)).length, 0);
  const [journal] = await store.entries<{ attachments: CustomerNote["attachments"] }>("customerNoteUpload");
  await store.put("customerNoteUpload", journal.id, { ...journal.value, attachments: journal.value.attachments.map(({ sha256: _checksum, ...file }) => file) });
  const note = await addCustomerNote(store, shop, "alice@example.com", shop.owner, input, files, "token");
  assert.equal(reservations, 1);
  assert.deepEqual(uploaded, ["reserved-0", "reserved-0"]);
  assert.equal(note.attachments[0].id, "reserved-0");
  assert.equal(note.attachments[0].sha256, createHash("sha256").update(Buffer.from(input.files[0].data, "base64")).digest("hex"));
  await addCustomerNote(store, shop, "alice@example.com", shop.owner, input, files, "token");
  assert.equal(uploaded.length, 2);
  assert.equal((await store.records<CustomerNote>("customerNote", shop)).length, 1);
  const largeFile = { ...input.files[0], data: Buffer.alloc(4 * 1024 * 1024).toString("base64") };
  await assert.rejects(() => addCustomerNote(store, shop, "alice@example.com", shop.owner, { ...input, requestId: randomUUID(), files: [largeFile, largeFile, largeFile] }, files, "token"), /合計10MB/);
  assert.equal(reservations, 1);
});

test("Customer image galleries include active image attachments in registration order and omit private memo text", () => {
  const image = { id: "image-1", name: "髪型.png", mimeType: "image/png", size: 10 };
  const notes: CustomerNote[] = [
    { ...fixtureNote, id: "old", createdAt: "2025-01-01T00:00:00Z", attachments: [image] },
    { ...fixtureNote, id: "new", createdAt: "2026-01-01T00:00:00Z", attachments: [{ ...image, id: "image-2" }, { ...image, id: "document", mimeType: "application/pdf" }] },
    { ...fixtureNote, id: "deleted", status: "deleted", attachments: [{ ...image, id: "deleted-image" }] },
  ];
  const images = customerImages(notes);
  assert.deepEqual(images.map(file => file.id), ["image-2", "image-1"]);
  assert.equal(images[0].noteId, "new");
  assert.equal(images[0].noteUpdatedAt, fixtureNote.updatedAt);
  assert.ok(!JSON.stringify(images).includes(fixtureNote.text));
  assert.equal(notes[0].id, "old");
});
