import { tr } from "../shared/i18n.ts";
import type { InquiryFileInput } from "../shared/inquiry-files.ts";
import { digest } from "./auth.ts";
import { checkedFileSizes, reserveAttachments, withAttachmentHashes, type CustomerFiles } from "./customer-files.ts";
import type { CustomerAttachment } from "./customers.ts";
import type { Store, Shop } from "./store.ts";

export type InquiryFileStorage = () => Promise<{ files: CustomerFiles; token: string }>;
type Journal = { shopId: string; hash: string; attachments: CustomerAttachment[]; uploaded?: boolean };
type QuotaWindow = { shopId: string; requests: string[]; bytes: number; expires: number };

export const publicInquiryHourlyLimit = 5;
export const publicInquiryDailyBytes = 500 * 1024 * 1024;
const hour = 3600000, day = 24 * hour;
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const journalId = (shop: Shop, requestKey: string) => digest(`${shop.id}:inquiry-files:${requestKey}`);

/** Saves reserved Drive IDs before uploading, so an interrupted request reuses them. Runs outside the shop lock. */
export async function prepareInquiryFiles(store: Store, shop: Shop, requestKey: string, input: InquiryFileInput[] = [], storage: InquiryFileStorage) {
  if (!input.length) return;
  const sizes = checkedFileSizes(input), id = journalId(shop, requestKey), hash = digest(JSON.stringify(input));
  await store.locked(`inquiry-files:${id}`, async () => {
    let journal = await store.get<Journal>("inquiryFileUpload", id);
    if (journal && (journal.shopId !== shop.id || journal.hash !== hash)) fail(409, tr("記録の内容が変わっています。新しい操作として保存してください。"));
    if (journal?.uploaded) return;
    const { files, token } = await storage();
    if (!journal) {
      journal = { shopId: shop.id, hash, attachments: await reserveAttachments(files, token, input, sizes) };
      await store.put("inquiryFileUpload", id, journal);
    }
    for (const [index, file] of input.entries()) await files.upload(shop, token, journal.attachments[index].id, file);
    await store.put("inquiryFileUpload", id, { ...journal, uploaded: true });
  });
}

/** The attachments prepared for exactly this input; the shop-locked write commits them with its record. */
export async function uploadedInquiryFiles(store: Store, shop: Shop, requestKey: string, input: InquiryFileInput[] = []) {
  if (!input.length) return [];
  const journal = await store.get<Journal>("inquiryFileUpload", journalId(shop, requestKey));
  if (journal?.shopId !== shop.id || journal.hash !== digest(JSON.stringify(input)) || !journal.uploaded) return fail(409, tr("添付ファイルを確認してください。"));
  return withAttachmentHashes(journal.attachments, input);
}

/** Limits storefront submissions before they use the owner's Drive storage or Gmail quota. A retried request is not counted twice. */
export async function reservePublicInquiry(store: Store, shop: Shop, email: string, requestKey: string, bytes: number) {
  const now = Date.now();
  await store.locked(`inquiry-quota:${shop.id}`, async () => {
    const customerId = digest(`${shop.id}:${email}:${Math.floor(now / hour)}`), shopId = digest(`${shop.id}:${Math.floor(now / day)}`);
    const customer = await store.get<QuotaWindow>("inquiryQuota", customerId) || { shopId: shop.id, requests: [], bytes: 0, expires: now + hour };
    if (customer.requests.includes(requestKey)) return;
    if (customer.requests.length >= publicInquiryHourlyLimit) fail(429, tr("少し時間をおいてお試しください"));
    // A shop-wide cap covers files only, so one account cannot block other customers' plain inquiries.
    const daily = await store.get<QuotaWindow>("inquiryQuota", shopId) || { shopId: shop.id, requests: [], bytes: 0, expires: now + day };
    if (bytes && daily.bytes + bytes > publicInquiryDailyBytes) fail(429, tr("添付の受付上限に達しました。ファイルを外して送信してください。"));
    await store.put("inquiryQuota", customerId, { ...customer, requests: [...customer.requests, requestKey] });
    if (bytes) await store.put("inquiryQuota", shopId, { ...daily, bytes: daily.bytes + bytes });
  });
}
