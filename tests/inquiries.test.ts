import { google } from "googleapis";
import { encrypt } from "../server/google.ts";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  filterInquiries,
  inquiryStatus,
  type InquiryFilter,
} from "../server/inquiries.ts";
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
    sheetId: "sheet",
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
        Cookie: `omai_session=${user}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }
  const reply = {
    requestId: randomUUID(),
    text: "写真をお持ちください",
    previousReply: "",
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
    previousReply: reply.text,
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
    { headers: { Cookie: "omai_session=owner" } },
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
    sheetId: "sheet",
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
  mock.method(google, "gmail", (() => ({
    users: {
      messages: {
        async send(input: { requestBody: { raw: string } }) {
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
        Cookie: "omai_session=owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "ご相談ありがとうございます",
        requestId: randomUUID(),
        previousReply: "",
      }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes(`To: ${question.email}`));
  assert.equal((await store.list("job")).length, 0);
});
