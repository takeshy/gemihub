import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import { inquiryFilesInputSchema } from "../shared/inquiry-files.ts";
import { digest } from "./auth.ts";
import { inquiryStatus, inquiryStatusSchema, manualInquirySchema, publicInquirySchema, inquiryInteractionSchema, type InquiryInteraction } from "./inquiries.ts";
import type { Inquiry, CustomerAttachment } from "./customers.ts";
import { checkedFileSizes } from "./customer-files.ts";
import { prepareInquiryFiles, reservePublicInquiry, uploadedInquiryFiles, type InquiryFileStorage } from "./inquiry-files.ts";
import type { Shop, Store } from "./store.ts";

/** The worker runs every minute, so a reply stops retrying after about one day of failed sends. */
export const maxInquiryMailAttempts = 1440;
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
export async function readInquiries(store: Store, shop: Shop, history = true): Promise<Inquiry[]> {
  if (!history) return store.records<Inquiry>("inquiry", shop);
  const [inquiries, entries] = await Promise.all([store.records<Inquiry>("inquiry", shop), store.records<InquiryInteraction>("inquiryInteraction", shop)]);
  const threads = new Map<string, InquiryInteraction[]>();
  for (const entry of entries) { const thread = threads.get(entry.inquiryId) || []; thread.push(entry); threads.set(entry.inquiryId, thread); }
  return inquiries.map(inquiry => ({ ...inquiry, interactions: (threads.get(inquiry.id) || []).sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || a.id.localeCompare(b.id)) }));
}
/** Undelivered replies follow contact corrections; an empty result means there is no address left to send to. */
export async function inquiryMailRecipient(store: Store, shop: Shop, interactionId: string) {
  const entry = await store.get<InquiryInteraction>("inquiryInteraction", interactionId);
  const inquiry = entry?.shopId === shop.id ? await store.get<Inquiry>("inquiry", entry.inquiryId) : undefined;
  return inquiry?.shopId === shop.id ? inquiry.email : "";
}
function setStatus(q: Inquiry, next: string) {
  if (inquiryStatus(q) !== next) {
    if (next === "completed") q.completedAt = new Date().toISOString();
    else delete q.completedAt;
  }
  q.status = next;
}
const replySchema = z.object({ text: z.string().trim().min(1).max(5000), requestId: z.uuid().optional(), previousReply: z.string().max(5000).optional(), previousEmail: z.string().max(320).optional(), status: inquiryStatusSchema.optional(), files: inquiryFilesInputSchema.optional() }).strict();
function parseEntry(action: string, data: unknown) {
  const input = action === "reply" ? replySchema.parse(data) : inquiryInteractionSchema.parse(data);
  if (input.files?.length && !input.requestId) fail(400, tr("画面を再読み込みして、添付ファイルを選び直してください。"));
  return input;
}
function assertReplyAllowed(store: Store, shop: Shop, q: Inquiry, input: ReturnType<typeof parseEntry>) {
  if (!q.email) fail(400, tr("メールアドレスがないためメールを送信できません。電話対応やメモとして記録してください。"));
  const previous = "previousReply" in input ? input.previousReply : undefined;
  if (previous !== undefined && previous !== q.reply) fail(409, tr("他の担当者が返信しています。最新の状態を確認してください"));
  const reviewedEmail = "previousEmail" in input ? input.previousEmail : undefined;
  if (reviewedEmail === undefined || reviewedEmail !== q.email) fail(409, tr("返信先が更新されています。最新の状態を確認してください。"));
  if (!shop.google && !shop.judge && !store.memory) fail(503, tr("店主の Google 再接続が必要です"));
}
/**
 * Uploads attachments before the shop lock, so a slow transfer never blocks other shop operations.
 * Accepted requests stop here without touching storage; writeInquiry repeats every check under the lock.
 */
export async function stageInquiryFiles(store: Store, shop: Shop, id: string | undefined, action: string, data: unknown, storage: InquiryFileStorage) {
  if (!(data as { files?: unknown[] } | undefined)?.files?.length) return;
  if (!id) {
    const input = manualInquirySchema.parse(data), inquiryId = digest(`${shop.id}:manual-inquiry:${input.requestId}`);
    if (!await store.get("inquiryCreateRequest", inquiryId)) await prepareInquiryFiles(store, shop, inquiryId, input.files, storage);
    return;
  }
  if (action !== "reply" && action !== "interactions") return;
  const q = await store.get<Inquiry>("inquiry", id);
  if (!q || q.shopId !== shop.id) fail(404, tr("お問い合わせがありません"));
  const input = parseEntry(action, data), requestKey = digest(`${shop.id}:${q.id}:${input.requestId}`);
  if (await store.get("inquiryEntryRequest", requestKey) || await store.get("inquiryReplyRequest", requestKey)) return;
  if (action === "reply") assertReplyAllowed(store, shop, q, input);
  await prepareInquiryFiles(store, shop, requestKey, input.files, storage);
}
type InquiryMail = { to: string; subject: string; body: string; inquiryInteractionId: string; attachments?: CustomerAttachment[] };
/** Caller holds the shop lock and has staged attachments; the record and mail intent commit atomically. */
export async function writeInquiry(store: Store, shop: Shop, actor: string, id: string | undefined, action: string, data: unknown, enqueue: (mail: InquiryMail, id: string) => Promise<unknown>) {
  if (!id) {
    const input = manualInquirySchema.parse(data), inquiryId = digest(`${shop.id}:manual-inquiry:${input.requestId}`), hash = digest(JSON.stringify(input));
    const receipt = await store.get<{ hash: string }>("inquiryCreateRequest", inquiryId);
    if (receipt && receipt.hash !== hash) fail(409, tr("お問い合わせの内容が変わっています。新しい操作として作成してください。"));
    const existing = await store.get<Inquiry>("inquiry", inquiryId);
    if (receipt && existing?.shopId === shop.id) return { inquiry: existing };
    const attachments = await uploadedInquiryFiles(store, shop, inquiryId, input.files);
    const { requestId: _requestId, files: _files, ...values } = input;
    const inquiry: Inquiry = { ...values, email: input.email.trim().toLowerCase(), id: inquiryId, shopId: shop.id, reply: "", status: "new", at: new Date().toISOString(), createdBy: actor, ...(attachments.length ? { attachments } : {}) };
    return store.transaction(async () => { await store.put("inquiry", inquiryId, inquiry); await store.put("inquiryCreateRequest", inquiryId, { shopId: shop.id, hash }); return { inquiry }; });
  }
  const q = await store.get<Inquiry>("inquiry", id);
  if (!q || q.shopId !== shop.id) fail(404, tr("お問い合わせがありません"));
  if (action === "contact") {
    if (!q.createdBy) fail(403, tr("公開ページから届いたお問い合わせの返信先は変更できません。"));
    const input = z.object({ email: z.union([z.literal(""), z.email()]), phone: z.string().trim().max(50), previousEmail: z.string(), previousPhone: z.string() }).strict().parse(data);
    const same = q.email === input.email && (q.phone || "") === input.phone;
    if (!same && (q.email !== input.previousEmail || (q.phone || "") !== input.previousPhone)) fail(409, tr("連絡先が更新されています。最新の状態を確認してください。"));
    q.email = input.email.toLowerCase(); q.phone = input.phone;
    await store.put("inquiry", q.id, q); return { ok: true };
  }
  if (action === "status") {
    const input = z.object({ status: inquiryStatusSchema, previousStatus: inquiryStatusSchema.optional() }).strict().parse(data), current = inquiryStatus(q);
    if (input.previousStatus && input.previousStatus !== current && input.status !== current) fail(409, tr("対応状況が更新されています。最新の状態を確認してください"));
    setStatus(q, input.status); await store.put("inquiry", q.id, q); return { ok: true };
  }
  const email = action === "reply";
  const input = parseEntry(action, data);
  const requestKey = digest(`${shop.id}:${q.id}:${input.requestId || randomUUID()}`);
  if (email) {
    const legacy = await store.get<{ hash: string; done: boolean }>("inquiryReplyRequest", requestKey);
    const legacyHash = digest(JSON.stringify({ text: input.text, previousReply: "previousReply" in input ? input.previousReply ?? null : null, status: "status" in input ? input.status ?? null : null }));
    if (legacy && (legacy.hash !== legacyHash || input.files?.length)) fail(409, tr("返信内容が変わっています。入力し直してください"));
    if (legacy?.done) return { ok: true };
  }
  const hash = digest(JSON.stringify({ action, ...input, requestId: undefined }));
  const receipt = await store.get<{ hash: string; done: boolean }>("inquiryEntryRequest", requestKey);
  if (receipt && receipt.hash !== hash) fail(409, tr("記録の内容が変わっています。新しい操作として保存してください。"));
  if (receipt?.done) return { ok: true };
  if (email) assertReplyAllowed(store, shop, q, input);
  const attachments = await uploadedInquiryFiles(store, shop, requestKey, input.files);
  return store.transaction(async () => {
    if (email) {
      if (q.reply && !q.emailHistory && !(await store.records<InquiryInteraction>("inquiryInteraction", shop)).some(entry => entry.inquiryId === q.id && entry.kind === "email")) {
        const legacyId = digest(`${shop.id}:${q.id}:legacy-reply`);
        await store.put("inquiryInteraction", legacyId, { id: legacyId, shopId: shop.id, inquiryId: q.id, kind: "email", text: q.reply, at: "", legacy: true } satisfies InquiryInteraction);
      }
      q.reply = input.text; q.emailHistory = true; setStatus(q, ("status" in input ? input.status : undefined) || inquiryStatus(q));
      await store.put("inquiry", q.id, q);
    }
    const entry: InquiryInteraction = { id: requestKey, shopId: shop.id, inquiryId: q.id, kind: email ? "email" : "kind" in input ? input.kind : "note", text: input.text, at: new Date().toISOString(), by: actor, ...(attachments.length ? { attachments } : {}), ...(email ? { delivery: shop.judge || (store.memory && !shop.google) ? "simulated" : "queued", to: q.email } : {}) };
    await store.put("inquiryInteraction", entry.id, entry);
    if (email) await enqueue({ to: q.email, subject: tr("{0} からの返信", shop.published?.name || shop.draft?.name || ""), body: input.text, inquiryInteractionId: entry.id, ...(attachments.length ? { attachments } : {}) }, digest(`${requestKey}:mail`));
    await store.put("inquiryEntryRequest", requestKey, { shopId: shop.id, inquiryId: q.id, hash, done: true }); return { ok: true };
  });
}

function parsePublicInquiry(shop: Shop, email: string, data: unknown) {
  const input = publicInquirySchema.parse(data);
  if (input.files?.length && !input.requestId) fail(400, tr("画面を再読み込みして、添付ファイルを選び直してください。"));
  return { input, id: digest(`${shop.id}:${email}:public-inquiry:${input.requestId || randomUUID()}`), hash: digest(JSON.stringify(input)) };
}
async function publicReceipt(store: Store, id: string, hash: string) {
  const receipt = await store.get<{ hash: string }>("publicInquiryRequest", id);
  if (receipt && receipt.hash !== hash) fail(409, tr("お問い合わせの内容が変わっています。新しい操作として作成してください。"));
  return !!receipt;
}
/** Runs before the shop lock: applies submission limits, then uploads. An accepted retry needs neither. */
export async function stagePublicInquiry(store: Store, shop: Shop, email: string, data: unknown, storage: InquiryFileStorage) {
  const { input, id, hash } = parsePublicInquiry(shop, email, data);
  if (await publicReceipt(store, id, hash)) return;
  const bytes = checkedFileSizes(input.files || []).reduce((sum, size) => sum + size, 0);
  await reservePublicInquiry(store, shop, email, input.requestId || id, bytes);
  await prepareInquiryFiles(store, shop, id, input.files, storage);
}
/** Caller holds the shop lock and has staged the same request. */
export async function createPublicInquiry(store: Store, shop: Shop, email: string, data: unknown, notify: (q: Inquiry) => Promise<void>) {
  const { input, id, hash } = parsePublicInquiry(shop, email, data);
  if (await publicReceipt(store, id, hash)) return { ok: true, id };
  const attachments = await uploadedInquiryFiles(store, shop, id, input.files);
  const q: Inquiry = { id, shopId: shop.id, email, name: input.name, message: input.message, reply: "", status: "new", source: "customer", at: new Date().toISOString(), ...(attachments.length ? { attachments } : {}) };
  return store.transaction(async () => { await store.put("inquiry", id, q); await notify(q); await store.put("publicInquiryRequest", id, { shopId: shop.id, hash }); return { ok: true, id }; });
}
