import { google } from "googleapis";
import { encrypt } from "../server/google.ts";
import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  filterInquiries,
  inquiryReplyState,
  inquiryStatus,
  type InquiryFilter,
  type InquiryInteraction,
} from "../server/inquiries.ts";
import { maxInquiryMailAttempts } from "../server/inquiry-service.ts";
import { createApp } from "../server/app.ts";
import { Store, type User } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample } from "../server/domain.ts";
import type { Inquiry } from "../server/customers.ts";

const question: Inquiry = {
  id: "question",
  shopId: "shop",
  name: "山田 花子",
  email: "hanako@example.com",
  message: "色の相談",
  reply: "",
  status: "open",
  at: "2026-10-01T15:00:00Z",
};
const filter: InquiryFilter = {
  showCompleted: false,
  query: "",
  reply: "all",
  from: "",
  to: "",
};
test("inquiries distinguish reply from completion, include legacy records and filter inclusive JST dates", () => {
  const records = [
    question,
    {
      ...question,
      id: "replied-open",
      status: "in_progress",
      reply: "ピンクをご用意します",
      at: "2026-10-02T14:59:59Z",
    },
    { ...question, id: "done", status: "completed" },
    { ...question, id: "legacy", status: "replied", reply: "回答しました" },
    { ...question, id: "before", at: "2026-10-01T14:59:59Z" },
    { ...question, id: "after", at: "2026-10-02T15:00:00Z" },
    { ...question, id: "invalid", at: "invalid" },
  ];
  const ids = (changes: Partial<InquiryFilter>) =>
    filterInquiries(records, { ...filter, ...changes }).map((q) => q.id);
  assert.equal(inquiryStatus(question), "in_progress");
  assert.equal(inquiryStatus(records[3]), "completed");
  assert.equal(ids({}).length, 5);
  assert.equal(ids({ showCompleted: true }).length, 7);
  assert.deepEqual(ids({ reply: "replied" }), ["replied-open"]);
  assert.deepEqual(ids({ showCompleted: true, reply: "replied" }), [
    "replied-open",
    "legacy",
  ]);
  assert.ok(ids({ showCompleted: true, reply: "unreplied" }).includes("done"));
  assert.deepEqual(ids({ query: " ピンク " }), ["replied-open"]);
  assert.equal(ids({ query: "HANAKO@EXAMPLE.COM" }).length, 5);
  assert.equal(ids({ query: "山田" }).length, 5);
  assert.equal(ids({ query: "色の相談" }).length, 5);
  assert.deepEqual(ids({ from: "2026-10-02", to: "2026-10-02" }), [
    "replied-open",
    "question",
  ]);
  assert.deepEqual(ids({ from: "2026-10-03", to: "2026-10-02" }), []);
  assert.equal(ids({})[0], "after");
  assert.equal(ids({}).at(-1), "invalid");
  assert.deepEqual(
    filterInquiries([{ ...question, at: undefined }], {
      ...filter,
      from: "2026-10-01",
    }),
    [],
  );
});

test("inquiry responses and status are independent, scoped to operators, durable and safe to retry", async (t) => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  // No credentials: replies queue mail locally without contacting Google.
  shop.google = {
    folderId: "folder",
    specId: "spec",
    historyId: "history",
  };
  await store.saveShop(shop);
  await store.put("inquiry", question.id, { ...question, shopId: shop.id });
  const other = await store.createShop("other@example.com");
  other.published = structuredClone(sample);
  await store.saveShop(other);
  await store.put("inquiry", "other-question", {
    ...question,
    id: "other-question",
    shopId: other.id,
  });
  const users: Record<string, User> = {
    owner: { email: shop.owner, name: "店主", role: "owner" },
    staff: { email: "staff@example.com", name: "スタッフ", role: "customer" },
    customer: {
      email: question.email,
      name: question.name,
      role: "customer",
      shopId: shop.id,
    },
    invited: { email: "invited@example.com", name: "招待中", role: "customer" },
    revoked: { email: "revoked@example.com", name: "解除済", role: "customer" },
    other: { email: other.owner, name: "他店", role: "owner" },
  };
  for (const [id, user] of Object.entries(users))
    await store.put("session", digest(id), {
      user,
      expires: Date.now() + 600000,
    });
  for (const id of ["staff", "invited", "revoked"])
    await store.put("member", `${shop.id}:${users[id].email}`, {
      shopId: shop.id,
      email: users[id].email,
      accepted: id === "staff",
      status: id === "staff" ? "accepted" : id,
    });
  const server = createApp(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    server.close();
    await store.close();
  });
  const base = `/api/shops/${shop.id}/inquiries`;
  async function post(action: string, data: unknown, user = "owner") {
    const response = await fetch(origin + action, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: `gemihub_session=${user}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }
  const reply = {
    requestId: randomUUID(),
    text: "写真をお持ちください",
    previousReply: "", previousEmail: question.email,
  };
  for (const id of ["customer", "invited", "revoked", "other", "anonymous"]) {
    assert.equal(
      (await post(`${base}/question/reply`, reply, id)).status,
      403,
      id,
    );
    assert.equal(
      (await post(`${base}/question/status`, { status: "completed" }, id))
        .status,
      403,
      id,
    );
  }
  for (const action of ["status", "reply"])
    assert.equal(
      (
        await post(
          `${base}/other-question/${action}`,
          action === "reply" ? reply : { status: "completed" },
        )
      ).status,
      404,
    );
  assert.equal(
    (await post(`${base}/question/status`, { status: "replied" })).status,
    400,
  );
  assert.equal(
    (await post(`${base}/question/reply`, { text: " " })).status,
    400,
  );
  assert.equal(
    (await post(`${base}/question/reply`, reply, "staff")).status,
    200,
  );
  let saved = (await store.records<Inquiry>("inquiry", shop)).find(
    (q) => q.id === question.id,
  )!;
  assert.equal(saved.reply, reply.text);
  assert.equal(saved.status, "in_progress");
  assert.equal((await store.list("job")).length, 1);
  assert.equal(
    (await post(`${base}/question/reply`, reply, "staff")).status,
    200,
  );
  assert.equal(
    (await store.list("job")).length,
    1,
    "duplicate retry does not queue another email",
  );
  assert.equal(
    (await post(`${base}/question/reply`, { ...reply, text: "別の返信" }))
      .status,
    409,
  );
  assert.equal(
    (
      await post(`${base}/question/reply`, {
        ...reply,
        requestId: randomUUID(),
        text: "古い画面から返信",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(`${base}/question/status`, {
        status: "completed",
        previousStatus: "in_progress",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(`${base}/question/status`, {
        status: "completed",
        previousStatus: "in_progress",
      })
    ).status,
    200,
    "status retry is idempotent",
  );
  assert.equal((await post(`${base}/question/reply`, reply)).status, 200);
  saved = (await store.records<Inquiry>("inquiry", shop)).find(
    (q) => q.id === question.id,
  )!;
  assert.equal(
    saved.status,
    "completed",
    "replay must not reopen a completed inquiry",
  );
  const secondReply = {
    requestId: randomUUID(),
    text: "追加のご案内です",
    previousReply: reply.text, previousEmail: question.email,
  };
  assert.equal((await post(`${base}/question/reply`, secondReply)).status, 200);
  assert.equal((await store.list("job")).length, 2);
  assert.equal(
    (
      await post(
        `${base}/question/status`,
        { status: "in_progress", previousStatus: "completed" },
        "staff",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(`${base}/question/status`, {
        status: "completed",
        previousStatus: "completed",
      })
    ).status,
    409,
    "stale status edit rejected",
  );
  const profile = await fetch(
    `${origin}/api/shops/${shop.id}/customers/${question.email}?period=all`,
    { headers: { Cookie: "gemihub_session=owner" } },
  );
  assert.equal(profile.status, 200);
  const customer = await profile.json();
  assert.equal(customer.history[0].inquiry.reply, secondReply.text);
  assert.equal(customer.history[0].inquiry.status, "in_progress");
});

test("an accepted inquiry reply sends its queued email before removing the mail job", async (t) => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.google = {
    folderId: "folder",
    specId: "spec",
    historyId: "history",
  };
  await store.saveShop(shop);
  await store.put("user", shop.owner, {
    email: shop.owner,
    name: "Owner",
    role: "owner",
    refreshToken: encrypt("test-refresh-token"),
  });
  await store.put("session", digest("owner"), {
    user: { email: shop.owner, name: "Owner", role: "owner" },
    expires: Date.now() + 600000,
  });
  await store.put("inquiry", question.id, { ...question, shopId: shop.id });
  const sent: string[] = [];
  let mailFailure = false;
  mock.method(google, "gmail", (() => ({
    users: {
      messages: {
        async send(input: { requestBody: { raw: string } }) {
          if (mailFailure) throw new Error("Temporary Gmail failure");
          sent.push(Buffer.from(input.requestBody.raw, "base64url").toString());
        },
      },
    },
  })) as any);
  const server = createApp(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    mock.restoreAll();
    server.close();
    await store.close();
  });
  const response = await fetch(
    `${origin}/api/shops/${shop.id}/inquiries/${question.id}/reply`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: "gemihub_session=owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "ご相談ありがとうございます",
        requestId: randomUUID(),
        previousReply: "", previousEmail: question.email,
      }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes(`To: ${question.email}`));
  assert.equal((await store.list("job")).length, 0);
  assert.equal((await store.records<import("../server/inquiries.ts").InquiryInteraction>("inquiryInteraction", shop))[0].delivery, "sent");
  const retryInput = { text: "A second email", requestId: randomUUID(), previousReply: "ご相談ありがとうございます", previousEmail: question.email };
  const retry = () => fetch(`${origin}/api/shops/${shop.id}/inquiries/${question.id}/reply`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(retryInput) });
  mailFailure = true; assert.equal((await retry()).status, 200);
  assert.equal((await store.list("job")).length, 1);
  assert.equal((await store.records<import("../server/inquiries.ts").InquiryInteraction>("inquiryInteraction", shop)).filter(entry => entry.delivery === "retrying").length, 1);
  mailFailure = false; assert.equal((await retry()).status, 200); assert.equal((await retry()).status, 200);
  assert.equal(sent.length, 2, "retry delivers the pending email once without replacing history");
  assert.equal((await store.list("job")).length, 0);
  assert.ok((await store.records<import("../server/inquiries.ts").InquiryInteraction>("inquiryInteraction", shop)).every(entry => entry.delivery === "sent"));
});

test("manual inquiries keep phone, customer and internal history, scoped retries, contacts and independent kanban states", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("support-owner@example.com");
  shop.published = structuredClone(sample); shop.google = { folderId: "folder", specId: "spec", historyId: "history" }; await store.saveShop(shop);
  const other = await store.createShop("other-support@example.com");
  for (const [id, email, role] of [["owner", shop.owner, "owner"], ["staff", "support-staff@example.com", "customer"], ["customer", question.email, "customer"], ["other", other.owner, "owner"], ["revoked", "revoked@example.com", "customer"]] as const) {
    await store.put("session", digest(id), { user: { email, name: id, role, shopId: role === "customer" ? shop.id : undefined }, expires: Date.now() + 600000 });
  }
  await store.put("member", `${shop.id}:support-staff@example.com`, { shopId: shop.id, email: "support-staff@example.com", accepted: true });
  await store.put("inquiry", "foreign", { ...question, id: "foreign", shopId: other.id });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  async function request(tail: string, data?: unknown, user = "owner") {
    const response = await fetch(`${origin}/api/shops/${shop.id}/inquiries${tail}`, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${user}`, "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  }
  const input = { requestId: randomUUID(), name: "電話のお客様", phone: "03-1234-5678", subject: "電話でのご相談", source: "phone", message: "色の相談を受けた" };
  for (const user of ["customer", "other", "revoked", "anonymous"]) {
    assert.equal((await request("", input, user)).status, 403);
    assert.equal((await request("", undefined, user)).status, 403);
    assert.equal((await request("/foreign/interactions", { requestId: randomUUID(), kind: "note", text: "private" }, user)).status, 403);
  }
  const created = await request("", input, "staff"); assert.equal(created.status, 200);
  const id = created.body.inquiry.id;
  assert.equal(created.body.inquiry.email, ""); assert.equal(created.body.inquiry.status, "new"); assert.equal(created.body.inquiry.createdBy, "support-staff@example.com");
  assert.equal((await request("", input)).body.inquiry.id, id);
  assert.equal((await request("", { ...input, message: "変更" })).status, 409);
  assert.equal((await request("", { ...input, requestId: randomUUID(), createdBy: "forged" })).status, 400);
  assert.equal((await request("/foreign/interactions", { requestId: randomUUID(), kind: "note", text: "private" })).status, 404);
  assert.equal((await request(`/${id}/reply`, { requestId: randomUUID(), text: "返信" })).status, 400);
  assert.equal((await store.list("job")).length, 0, "phone-only creation and failed email do not send mail");
  for (const kind of ["phone", "customer", "note"]) {
    const entry = { requestId: randomUUID(), kind, text: `record-${kind}` };
    assert.equal((await request(`/${id}/interactions`, entry, "staff")).status, 200);
    assert.equal((await request(`/${id}/interactions`, entry)).status, 200);
    assert.equal((await request(`/${id}/interactions`, { ...entry, text: "different" })).status, 409);
  }
  assert.equal((await store.records("inquiryInteraction", shop)).length, 3);
  assert.equal((await store.list("job")).length, 0, "internal and incoming records never enqueue email");
  let rows = (await request("")).body as Inquiry[];
  assert.equal(filterInquiries(rows, { ...filter, query: "record-note" }).length, 1);
  assert.equal(filterInquiries(rows, { ...filter, query: "03-1234" }).length, 1);
  assert.equal(filterInquiries(rows, { ...filter, query: "電話でのご相談" }).length, 1);
  assert.equal(rows[0].interactions?.length, 3);
  const contact = { email: "guest@example.com", phone: input.phone, previousEmail: "", previousPhone: input.phone };
  assert.equal((await request(`/${id}/contact`, contact)).status, 200);
  assert.equal((await request(`/${id}/contact`, contact)).status, 200);
  assert.equal((await request(`/${id}/contact`, { ...contact, email: "stale@example.com" })).status, 409);
  await store.put("inquiry", "public", { ...question, id: "public", shopId: shop.id });
  assert.equal((await request("/public/contact", contact)).status, 403, "verified public addresses cannot be replaced");
  assert.equal((await request(`/${id}/status`, { status: "waiting", previousStatus: "new" })).status, 200);
  assert.equal((await request(`/${id}/status`, { status: "completed", previousStatus: "new" })).status, 409);
  const email = { requestId: randomUUID(), text: "email one", previousReply: "", previousEmail: "guest@example.com" };
  assert.equal((await request(`/${id}/reply`, email)).status, 200);
  assert.equal((await request(`/${id}/reply`, email)).status, 200);
  assert.equal((await store.list("job")).length, 1);
  assert.equal((await request(`/${id}/reply`, { requestId: randomUUID(), text: "email two", previousReply: "email one", previousEmail: "guest@example.com" })).status, 200);
  rows = (await request("")).body;
  const saved = rows.find(row => row.id === id)!;
  assert.equal(saved.status, "waiting", "email does not move kanban state");
  assert.equal(saved.reply, "email two");
  assert.deepEqual(saved.interactions!.filter(entry => entry.kind === "email").map(entry => entry.text).sort(), ["email one", "email two"]);
  assert.ok(saved.interactions!.filter(entry => entry.kind === "email").every(entry => entry.to === "guest@example.com" && entry.delivery === "queued"));
  const customer = await fetch(`${origin}/api/shops/${shop.id}/customers/guest@example.com?period=all`, { headers: { Cookie: "gemihub_session=owner" } });
  assert.equal(customer.status, 200);
  const detail = await customer.json(); assert.equal(detail.history.find((event: any) => event.inquiry?.id === id).inquiry.interactions.length, 5);
  const exportResponse = await fetch(`${origin}/api/shops/${shop.id}/export`, { headers: { Cookie: "gemihub_session=owner" } });
  const exported = await exportResponse.json(); assert.equal(exported.records.inquiryInteractions.length, 5);
  assert.ok(exported.records.inquiryInteractions.every((entry: any) => entry.shopId === shop.id));
  await assert.rejects(store.delete("inquiryInteraction", saved.interactions![0].id), /状態変更/);
});

test("legacy reply retries stay idempotent and later emails preserve the previous reply without inventing its date", async t => {
  const { writeInquiry, readInquiries } = await import("../server/inquiry-service.ts");
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("legacy-support@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
  await store.put("inquiry", question.id, { ...question, shopId: shop.id, reply: "old reply" });
  const input = { requestId: randomUUID(), text: "old reply", previousReply: "" };
  const key = digest(`${shop.id}:${question.id}:${input.requestId}`);
  await store.put("inquiryReplyRequest", key, { shopId: shop.id, inquiryId: question.id, hash: digest(JSON.stringify({ text: input.text, previousReply: input.previousReply, status: null })), done: true });
  const sent: unknown[] = [];
  const queue = async (mail: unknown) => { sent.push(mail); };
  await writeInquiry(store, shop, shop.owner, question.id, "reply", input, queue);
  assert.equal(sent.length, 0, "retry from an older client never queues the original email twice");
  await writeInquiry(store, shop, shop.owner, question.id, "reply", { requestId: randomUUID(), text: "new reply", previousReply: "old reply", previousEmail: question.email }, queue);
  const rows = await readInquiries(store, shop); assert.equal(rows[0].interactions!.length, 2);
  const legacy = rows[0].interactions!.find(entry => entry.legacy)!; assert.equal(legacy.text, "old reply"); assert.equal(legacy.at, "");
});

test("an inquiry email and its retry receipt roll back when durable queueing fails", async t => {
  const { writeInquiry } = await import("../server/inquiry-service.ts");
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("atomic-support@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
  await store.put("inquiry", question.id, { ...question, shopId: shop.id });
  const input = { requestId: randomUUID(), text: "message", previousReply: "", previousEmail: question.email };
  await assert.rejects(writeInquiry(store, shop, shop.owner, question.id, "reply", input, async () => { throw new Error("queue unavailable"); }), /queue unavailable/);
  assert.equal((await store.get<Inquiry>("inquiry", question.id))!.reply, "");
  assert.equal((await store.records("inquiryInteraction", shop)).length, 0);
  assert.equal((await store.list("inquiryEntryRequest")).length, 0);
  let queued = 0;
  await writeInquiry(store, shop, shop.owner, question.id, "reply", input, async () => { queued++; });
  assert.equal(queued, 1); assert.equal((await store.records("inquiryInteraction", shop)).length, 1);
});

async function startReplyApp(t: TestContext, owner: string, connected = true) {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop(owner);
  shop.published = structuredClone(sample);
  if (connected) shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  await store.put("user", shop.owner, { email: shop.owner, name: "Owner", role: "owner", refreshToken: encrypt("test-refresh-token") });
  await store.put("session", digest("owner"), { user: { email: shop.owner, name: "Owner", role: "owner" }, expires: Date.now() + 600000 });
  await store.put("inquiry", question.id, { ...question, shopId: shop.id, createdBy: shop.owner });
  const sent: string[] = [];
  const mail = { fail: false };
  mock.method(google, "gmail", (() => ({ users: { messages: { async send(input: { requestBody: { raw: string } }) {
    if (mail.fail) throw new Error("Temporary Gmail failure");
    sent.push(Buffer.from(input.requestBody.raw, "base64url").toString());
  } } } })) as any);
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    mock.restoreAll();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await store.close();
  });
  const post = async (tail: string, data: unknown) => (await fetch(`${origin}/api/shops/${shop.id}/inquiries/${question.id}/${tail}`, {
    method: "POST",
    headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })).status;
  const entries = () => store.records<InquiryInteraction>("inquiryInteraction", shop);
  const failDelivery = (delivery: InquiryInteraction["delivery"]) => {
    const put = store.put.bind(store);
    mock.method(store, "put", async (kind: string, id: string, value: { delivery?: string }) => {
      if (kind === "inquiryInteraction" && value.delivery === delivery) throw new Error("Delivery state unavailable");
      return put(kind, id, value);
    });
  };
  return { store, shop, sent, mail, post, entries, failDelivery };
}
const emailReply = (changes = {}) => ({ requestId: randomUUID(), text: "ご連絡ありがとうございます", previousReply: "", previousEmail: question.email, ...changes });

test("phone-only inquiries join an existing phone customer's CRM without using its key as an email address", async t => {
  const { savePhoneCustomer, aggregateCustomers } = await import("../server/customers.ts");
  const { writeInquiry, readInquiries } = await import("../server/inquiry-service.ts");
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("phone-inquiry-owner@example.com");
  const customer = { email: await savePhoneCustomer(store, shop.id, "Phone customer", "03-1234-5678", shop.owner), name: "Phone customer", phone: "03-1234-5678" };
  let mails = 0;
  const result = await writeInquiry(store, shop, shop.owner, undefined, "create", { requestId: randomUUID(), name: customer.name, email: "", phone: customer.phone, message: "Phone follow-up", source: "phone" }, async () => { mails++; });
  const inquiries = await readInquiries(store, shop);
  const customers = aggregateCustomers([], inquiries, [], new Date(), undefined, await store.records("customer", shop));
  assert.equal(customers.length, 1);
  assert.equal(customers[0].email, customer.email);
  assert.equal(customers[0].phone, customer.phone);
  assert.equal(customers[0].history[0].kind, "inquiry");
  assert.equal(inquiries[0].id, result.inquiry!.id);
  assert.equal(inquiries[0].email, "");
  assert.equal(mails, 0);
});

test("a reply is rejected when the recipient changed after the operator reviewed it", async t => {
  const { store, sent, post, entries } = await startReplyApp(t, "recipient-owner@example.com");
  assert.equal(await post("reply", emailReply({ previousEmail: "reviewed@example.com" })), 409);
  assert.equal((await store.list("job")).length, 0);
  assert.equal((await entries()).length, 0);
  assert.equal((await store.get<Inquiry>("inquiry", question.id))!.reply, "");
  assert.equal(await post("reply", emailReply()), 200);
  assert.equal(sent.length, 1);
});

test("a new reply cannot omit the reviewed recipient, before or after a contact correction", async t => {
  const { store, sent, post, entries } = await startReplyApp(t, "required-recipient@example.com");
  const { previousEmail: _reviewed, ...oldClientReply } = emailReply();
  assert.equal(await post("reply", oldClientReply), 409);
  assert.equal(await post("contact", { email: "corrected@example.com", phone: "", previousEmail: question.email, previousPhone: "" }), 200);
  assert.equal(await post("reply", oldClientReply), 409);
  assert.equal(await post("reply", { ...oldClientReply, previousEmail: question.email }), 409);
  assert.equal((await store.list("job")).length, 0);
  assert.equal((await store.list("inquiryEntryRequest")).length, 0);
  assert.equal((await entries()).length, 0);
  assert.equal((await store.get<Inquiry>("inquiry", question.id))!.reply, "");
  assert.equal(sent.length, 0);
  assert.equal(await post("reply", { ...oldClientReply, previousEmail: "corrected@example.com" }), 200);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("To: corrected@example.com"));
});

test("a previously accepted history-era request still replays without previousEmail", async t => {
  const { store, shop, sent, post, entries } = await startReplyApp(t, "accepted-recipient@example.com");
  const { previousEmail: _reviewed, ...oldClientReply } = emailReply();
  const requestKey = digest(`${shop.id}:${question.id}:${oldClientReply.requestId}`);
  const hash = digest(JSON.stringify({ action: "reply", text: oldClientReply.text, previousReply: oldClientReply.previousReply }));
  await store.put("inquiryEntryRequest", requestKey, { shopId: shop.id, inquiryId: question.id, hash, done: true });
  await store.put("inquiry", question.id, { ...question, shopId: shop.id, createdBy: shop.owner, reply: oldClientReply.text });
  await store.put("inquiryInteraction", requestKey, { id: requestKey, shopId: shop.id, inquiryId: question.id, kind: "email", text: oldClientReply.text, at: new Date().toISOString(), to: question.email, delivery: "queued" } satisfies InquiryInteraction);
  const jobId = digest(`${requestKey}:mail`);
  await store.put("job", jobId, { id: jobId, shopId: shop.id, type: "mail", to: question.email, subject: "Previously accepted reply", body: oldClientReply.text, inquiryInteractionId: requestKey, attempts: 0 });
  assert.equal(await post("contact", { email: "corrected@example.com", phone: "", previousEmail: question.email, previousPhone: "" }), 200);
  assert.equal(await post("reply", oldClientReply), 200);
  assert.equal(await post("reply", oldClientReply), 200);
  assert.equal(await post("reply", { ...oldClientReply, text: "changed payload" }), 409);
  const saved = await entries();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].delivery, "sent");
  assert.equal(saved[0].to, "corrected@example.com");
  assert.equal((await store.list("job")).length, 0);
  assert.equal(sent.length, 1, "a legacy retry delivers the existing job without adding another reply");
});

test("mail accepted by Gmail is never resent when its delivery state cannot be saved", async t => {
  const { store, sent, post, failDelivery } = await startReplyApp(t, "sent-owner@example.com");
  failDelivery("sent");
  const reply = emailReply();
  assert.equal(await post("reply", reply), 200);
  assert.equal(sent.length, 1);
  assert.equal((await store.list("job")).length, 0);
  assert.equal(await post("reply", reply), 200);
  assert.equal(sent.length, 1);
});

test("a failed delivery-state save does not stop the remaining mail jobs", async t => {
  const { store, shop, mail, post, failDelivery } = await startReplyApp(t, "queue-owner@example.com");
  mail.fail = true;
  const reply = emailReply();
  assert.equal(await post("reply", reply), 200);
  await store.put("job", "later-job", { id: "later-job", shopId: shop.id, type: "mail", to: "later@example.com", subject: "s", body: "b", attempts: 0 });
  failDelivery("retrying");
  assert.equal(await post("reply", reply), 200);
  assert.deepEqual((await store.list<{ attempts: number }>("job")).map(job => job.attempts), [2, 1]);
});

test("a corrected contact redirects undelivered replies and history shows the real recipient", async t => {
  const { store, sent, mail, post, entries } = await startReplyApp(t, "contact-owner@example.com");
  mail.fail = true;
  const reply = emailReply();
  assert.equal(await post("reply", reply), 200);
  assert.equal((await entries())[0].delivery, "retrying");
  assert.equal(await post("contact", { email: "fixed@example.com", phone: "", previousEmail: question.email, previousPhone: "" }), 200);
  mail.fail = false;
  assert.equal(await post("reply", reply), 200);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("To: fixed@example.com"));
  assert.ok(!sent[0].includes(question.email));
  const [entry] = await entries();
  assert.equal(entry.to, "fixed@example.com");
  assert.equal(entry.delivery, "sent");
  assert.equal((await store.list("job")).length, 0);
});

test("a removed contact stops undelivered replies instead of sending to the old address", async t => {
  const { store, sent, mail, post, entries } = await startReplyApp(t, "removed-owner@example.com");
  mail.fail = true;
  const reply = emailReply();
  assert.equal(await post("reply", reply), 200);
  assert.equal(await post("contact", { email: "", phone: "03-1234-5678", previousEmail: question.email, previousPhone: "" }), 200);
  mail.fail = false;
  assert.equal(await post("reply", reply), 200);
  assert.equal(sent.length, 0);
  assert.equal((await store.list("job")).length, 0);
  assert.equal((await entries())[0].delivery, "failed");
});

test("a permanently failing reply stops retrying and is shown as undelivered", async t => {
  const { store, mail, post, entries } = await startReplyApp(t, "attempts-owner@example.com");
  mail.fail = true;
  const reply = emailReply();
  assert.equal(await post("reply", reply), 200);
  const [job] = await store.list<{ id: string; attempts: number }>("job");
  await store.put("job", job.id, { ...job, attempts: maxInquiryMailAttempts - 1 });
  assert.equal(await post("reply", reply), 200);
  assert.equal((await store.list("job")).length, 0);
  const rows = [{ reply: reply.text, interactions: await entries() }];
  assert.equal(rows[0].interactions[0].delivery, "failed");
  assert.equal(inquiryReplyState(rows[0]), "failed");
});

test("a shop without Google reports a demo reply instead of leaving it queued forever", async t => {
  const { store, sent, post, entries } = await startReplyApp(t, "offline-owner@example.com", false);
  assert.equal(await post("reply", emailReply()), 200);
  assert.equal((await store.list("job")).length, 0);
  assert.equal(sent.length, 0);
  assert.equal((await entries())[0].delivery, "simulated");
});

test("only the first reply scans history to preserve a legacy reply", async t => {
  const { writeInquiry, readInquiries } = await import("../server/inquiry-service.ts");
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("scan-owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
  await store.put("inquiry", question.id, { ...question, shopId: shop.id, reply: "old reply" });
  const records = mock.method(store, "records");
  const scans = () => records.mock.calls.filter(call => call.arguments[0] === "inquiryInteraction").length;
  const send = (text: string, previousReply: string) => writeInquiry(store, shop, shop.owner, question.id, "reply", { requestId: randomUUID(), text, previousReply, previousEmail: question.email }, async () => {});
  await send("second", "old reply");
  assert.equal(scans(), 1);
  await send("third", "second");
  assert.equal(scans(), 1);
  assert.equal(await readInquiries(store, shop, false).then(rows => rows[0].interactions), undefined);
  assert.equal(scans(), 1, "summaries that discard history do not read it");
  assert.deepEqual((await readInquiries(store, shop))[0].interactions!.map(entry => entry.text).sort(), ["old reply", "second", "third"]);
});

test("reply badges follow the latest email delivery", () => {
  const entry = (delivery: InquiryInteraction["delivery"]): InquiryInteraction => ({ id: "e", shopId: "s", inquiryId: "q", kind: "email", text: "t", at: "2026-10-01T00:00:00Z", delivery });
  assert.equal(inquiryReplyState({ reply: "" }), "unreplied");
  assert.equal(inquiryReplyState({ reply: "t" }), "replied");
  assert.equal(inquiryReplyState({ reply: "t", interactions: [entry("sent")] }), "replied");
  for (const delivery of ["queued", "retrying", "simulated", "failed"] as const) assert.equal(inquiryReplyState({ reply: "t", interactions: [entry(delivery)] }), delivery);
});
