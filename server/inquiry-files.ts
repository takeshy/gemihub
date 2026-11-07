import { tr } from "../shared/i18n.ts";
import type { InquiryFileInput } from "../shared/inquiry-files.ts";
import { digest } from "./auth.ts";
import type { CustomerFiles } from "./customer-files.ts";
import { customerFileLimit, customerTotalFileLimit, type CustomerAttachment } from "./customers.ts";
import type { Store, Shop } from "./store.ts";

export type InquiryFileStorage = { files: CustomerFiles; token: string };
type Journal = { shopId: string; hash: string; attachments: CustomerAttachment[]; uploaded?: boolean };
export async function prepareInquiryFiles(store: Store, shop: Shop, requestKey: string, input: InquiryFileInput[] = [], storage?: InquiryFileStorage): Promise<CustomerAttachment[]> {
  if (!input.length) return [];
  const decoded = input.map(file => Buffer.from(file.data, "base64"));
  if (decoded.some((bytes, index) => bytes.length > customerFileLimit || bytes.toString("base64") !== input[index].data) || decoded.reduce((sum, bytes) => sum + bytes.length, 0) > customerTotalFileLimit)
    throw Object.assign(new Error(tr("添付は1ファイル5MB、合計10MB以内にしてください")), { status: 400 });
  if (!storage) throw Object.assign(new Error(tr("店主の Google 再接続が必要です")), { status: 503 });
  const id = digest(`${shop.id}:inquiry-files:${requestKey}`), hash = digest(JSON.stringify(input));
  let journal = await store.get<Journal>("inquiryFileUpload", id);
  if (journal && (journal.shopId !== shop.id || journal.hash !== hash)) throw Object.assign(new Error(tr("記録の内容が変わっています。新しい操作として保存してください。")), { status: 409 });
  if (!journal) {
    const ids = await storage.files.reserve(input.length, storage.token);
    if (ids.length !== input.length) throw new Error(tr("添付ファイルの保存先を作成できませんでした"));
    journal = { shopId: shop.id, hash, attachments: input.map((file, index) => ({ id: ids[index], name: file.name, mimeType: file.mimeType, size: decoded[index].length })) };
    // This journal is outside the business transaction: interrupted uploads reuse their Drive IDs.
    await store.put("inquiryFileUpload", id, journal);
  }
  if (!journal.uploaded) {
    for (const [index, file] of input.entries()) await storage.files.upload(shop, storage.token, journal.attachments[index].id, file);
    await store.put("inquiryFileUpload", id, { ...journal, uploaded: true });
  }
  return journal.attachments;
}
