import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample, dateJST } from "../server/domain.ts";
import { encrypt, sendMail } from "../server/google.ts";
import type { JudgeMail } from "../server/judge.ts";
import { Store } from "../server/store.ts";

test("Gmail sends a single message with validated, unique CC recipients and leaves login emails private", async t => {
  const sent: string[] = [];
  t.mock.method(google, "gmail", (() => ({ users: { messages: { async send(input: { userId: string; requestBody: { raw: string } }) {
    assert.equal(input.userId, "me");
    sent.push(Buffer.from(input.requestBody.raw, "base64url").toString());
  } } } })) as never);
  const token = encrypt("owner-refresh");
  await sendMail(token, "customer@example.com", "予約完了", "予約内容", ["owner@example.com", "OWNER@example.com", "CUSTOMER@example.com"]);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^To: customer@example.com\r\nCc: owner@example.com\r\n/);
  const [headers, body] = sent[0].split("\r\n\r\n");
  assert.equal(Buffer.from(headers.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)![1], "base64").toString(), "予約完了");
  assert.equal(Buffer.from(body, "base64").toString(), "予約内容");
  await sendMail(token, "customer@example.com", "ログイン", "認証リンク");
  assert.doesNotMatch(sent[1], /\r\nCc:/);
  for (const address of ["bad", "owner@example.com\r\nBcc: stranger@example.com", "owner@example.com,stranger@example.com"]) {
    await assert.rejects(sendMail(token, "customer@example.com", "予約", "内容", [address]));
    await assert.rejects(sendMail(token, address, "予約", "内容"));
  }
  assert.equal(sent.length, 2, "invalid recipients never reach Gmail");
});

test("unpaid bookings send customer confirmations with owner CC, retain CC on retry and record judge mail without delivery", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.published.hours.closedWeekdays = [];
  shop.published.notificationEmail = "OWNER@example.com";
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  await store.put("user", shop.owner, { email: shop.owner, name: "Owner", role: "owner", refreshToken: encrypt("owner-refresh") });
  const email = "customer@example.com";
  await store.put("session", digest("customer"), { user: { email, name: "Customer", role: "customer", shopId: shop.id, authMethod: "email" }, expires: Date.now() + 600000 });
  await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name: "Customer", birthDate: "1990-01-01", gender: "not_specified" });
  const sent: string[] = [];
  let failing = true;
  t.mock.method(google, "gmail", (() => ({ users: { messages: { async send(input: { requestBody: { raw: string } }) {
    if (failing) throw new Error("Gmail temporarily unavailable");
    sent.push(Buffer.from(input.requestBody.raw, "base64url").toString());
  } } } })) as never);
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const call = async (path: string, data?: unknown) => {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: "gemihub_session=customer", "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const base = `/api/public/${shop.slug}`;
  const nextInput = async () => {
    const date = dateJST(new Date(Date.now() + 4 * 86400000));
    const slots = await call(`${base}/slots?date=${date}&menu=simple&staff=aoi`);
    assert.ok(slots.length);
    return { name: "Customer", menuId: "simple", staffId: "aoi", start: slots[0].start, requestId: randomUUID() };
  };
  const input = await nextInput();
  const first = await call(`${base}/bookings`, input);
  assert.equal(first.ok, true, "mail delivery failure does not undo a confirmed booking");
  const queued = await store.list<{ to: string; cc: string[]; attempts: number }>("job");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].to, email);
  assert.deepEqual(queued[0].cc.map(address => address.toLowerCase()), [shop.owner]);
  assert.equal(queued[0].attempts, 1);
  assert.equal((await call(`${base}/bookings`, input)).booking.id, first.booking.id);
  assert.equal((await store.list("job")).length, 1, "retrying a booking does not enqueue another email");
  failing = false;
  await call(`${base}/bookings`, await nextInput());
  assert.equal(sent.length, 2, "the existing outbox retries the first confirmation");
  assert.deepEqual(await store.list("job"), []);
  for (const raw of sent) assert.match(raw, /^To: customer@example.com\r\nCc: OWNER@example.com\r\n/);
  for (const raw of sent) {
    const text = Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString();
    assert.ok(!text.includes(first.booking.id), "internal booking IDs are not included in emails");
    assert.match(text, /Customer/);
    assert.ok(text.includes(shop.published.menus[0].name));
  }
  const previousInvite = process.env.JUDGE_INVITE, previousUntil = process.env.JUDGE_UNTIL;
  process.env.JUDGE_INVITE = "booking-mail-test-invitation-123456789";
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  t.after(() => {
    if (previousInvite === undefined) delete process.env.JUDGE_INVITE; else process.env.JUDGE_INVITE = previousInvite;
    if (previousUntil === undefined) delete process.env.JUDGE_UNTIL; else process.env.JUDGE_UNTIL = previousUntil;
  });
  shop.judge = { createdAt: new Date().toISOString() };
  await store.saveShop(shop);
  await call(`${base}/bookings`, await nextInput());
  const recorded = await store.list<JudgeMail>("judgeMail");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].to, email);
  assert.deepEqual(recorded[0].cc, ["OWNER@example.com"]);
  assert.equal(sent.length, 2, "judge confirmations are recorded without real delivery");
});
