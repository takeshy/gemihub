import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import { inquiryStatus, inquiryStatusSchema, manualInquirySchema, inquiryInteractionSchema, type InquiryInteraction } from "./inquiries.ts";
import type { Inquiry } from "./customers.ts";
import type { Shop, Store } from "./store.ts";

const key = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
export async function readInquiries(store: Store, shop: Shop): Promise<Inquiry[]> {
  const [inquiries, entries] = await Promise.all([store.records<Inquiry>("inquiry", shop), store.records<InquiryInteraction>("inquiryInteraction", shop)]);
  const threads = new Map<string, InquiryInteraction[]>();
  for (const entry of entries) {
    const thread = threads.get(entry.inquiryId) || [];
    thread.push(entry); threads.set(entry.inquiryId, thread);
  }
  return inquiries.map(inquiry => ({ ...inquiry, interactions: (threads.get(inquiry.id) || []).sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || a.id.localeCompare(b.id)) }));
}

/** Caller holds the shop lock. Records, retry receipt and mail intent commit together. */
export async function writeInquiry(store: Store, shop: Shop, actor: string, id: string | undefined, action: string, data: unknown, enqueue: (mail: { to: string; subject: string; body: string; inquiryInteractionId: string }, id: string) => Promise<unknown>) {
  return store.transaction(async () => {
    if (!id) {
      const input = manualInquirySchema.parse(data);
      const inquiryId = key(`${shop.id}:manual-inquiry:${input.requestId}`);
      const hash = key(JSON.stringify(input));
      const receipt = await store.get<{ hash: string }>("inquiryCreateRequest", inquiryId);
      if (receipt && receipt.hash !== hash) fail(409, tr("お問い合わせの内容が変わっています。新しい操作として作成してください。"));
      const existing = await store.get<Inquiry>("inquiry", inquiryId);
      if (receipt && existing?.shopId === shop.id) return { inquiry: existing };
      const { requestId: _requestId, ...values } = input;
      const inquiry: Inquiry = { ...values, email: input.email.trim().toLowerCase(), id: inquiryId, shopId: shop.id, reply: "", status: "new", at: new Date().toISOString(), createdBy: actor };
      await store.put("inquiry", inquiryId, inquiry);
      await store.put("inquiryCreateRequest", inquiryId, { shopId: shop.id, hash });
      return { inquiry };
    }
    const q = await store.get<Inquiry>("inquiry", id);
    if (!q || q.shopId !== shop.id) fail(404, tr("お問い合わせがありません"));
    if (action === "contact") {
      if (!q.createdBy) fail(403, tr("公開ページから届いたお問い合わせの返信先は変更できません。"));
      const input = z.object({ email: z.union([z.literal(""), z.email()]), phone: z.string().trim().max(50), previousEmail: z.string(), previousPhone: z.string() }).strict().parse(data);
      const same = q.email === input.email && (q.phone || "") === input.phone;
      if (!same && (q.email !== input.previousEmail || (q.phone || "") !== input.previousPhone)) fail(409, tr("連絡先が更新されています。最新の状態を確認してください。"));
      q.email = input.email.toLowerCase(); q.phone = input.phone;
      await store.put("inquiry", q.id, q);
      return { ok: true };
    }
    if (action === "status") {
      const input = z.object({ status: inquiryStatusSchema, previousStatus: inquiryStatusSchema.optional() }).strict().parse(data);
      const current = inquiryStatus(q);
      if (input.previousStatus && input.previousStatus !== current && input.status !== current) fail(409, tr("対応状況が更新されています。最新の状態を確認してください"));
      q.status = input.status;
      await store.put("inquiry", q.id, q);
      return { ok: true };
    }
    const email = action === "reply";
    const input = email ? z.object({ text: z.string().trim().min(1).max(5000), requestId: z.uuid().optional(), previousReply: z.string().max(5000).optional(), status: inquiryStatusSchema.optional() }).strict().parse(data) : inquiryInteractionSchema.parse(data);
    const requestKey = key(`${shop.id}:${q.id}:${input.requestId || randomUUID()}`);
    if (email) {
      const legacy = await store.get<{ hash: string; done: boolean }>("inquiryReplyRequest", requestKey);
      const legacyHash = key(JSON.stringify({ text: input.text, previousReply: "previousReply" in input ? input.previousReply ?? null : null, status: "status" in input ? input.status ?? null : null }));
      if (legacy && legacy.hash !== legacyHash) fail(409, tr("返信内容が変わっています。入力し直してください"));
      if (legacy?.done) return { ok: true };
    }
    const hash = key(JSON.stringify({ action, ...input, requestId: undefined }));
    const receipt = await store.get<{ hash: string; done: boolean }>("inquiryEntryRequest", requestKey);
    if (receipt && receipt.hash !== hash) fail(409, tr("記録の内容が変わっています。新しい操作として保存してください。"));
    if (receipt?.done) return { ok: true };
    if (email) {
      if (!q.email) fail(400, tr("メールアドレスがないためメールを送信できません。電話対応やメモとして記録してください。"));
      const previous = "previousReply" in input ? input.previousReply : undefined;
      if (previous !== undefined && previous !== q.reply) fail(409, tr("他の担当者が返信しています。最新の状態を確認してください"));
      // Preserve a reply from before the history feature before replacing the legacy latest-reply field.
      const entries = await store.records<InquiryInteraction>("inquiryInteraction", shop);
      if (q.reply && !entries.some(entry => entry.inquiryId === q.id && entry.kind === "email")) {
        const legacyId = key(`${shop.id}:${q.id}:legacy-reply`);
        await store.put("inquiryInteraction", legacyId, { id: legacyId, shopId: shop.id, inquiryId: q.id, kind: "email", text: q.reply, at: "", legacy: true } satisfies InquiryInteraction);
      }
      q.reply = input.text;
      q.status = ("status" in input ? input.status : undefined) || inquiryStatus(q);
      await store.put("inquiry", q.id, q);
    }
    const entry: InquiryInteraction = { id: requestKey, shopId: shop.id, inquiryId: q.id, kind: email ? "email" : "kind" in input ? input.kind : "note", text: input.text, at: new Date().toISOString(), by: actor, ...(email ? { delivery: shop.judge ? "simulated" : "queued", to: q.email } : {}) };
    await store.put("inquiryInteraction", entry.id, entry);
    if (email) await enqueue({ to: q.email, subject: tr("{0} からの返信", shop.published?.name || shop.draft?.name || ""), body: input.text, inquiryInteractionId: entry.id }, key(`${requestKey}:mail`));
    await store.put("inquiryEntryRequest", requestKey, { shopId: shop.id, inquiryId: q.id, hash, done: true });
    return { ok: true };
  });
}
