import { tr } from "../shared/i18n.ts";
import { createHash } from "node:crypto";
import type { Store, Shop } from "./store.ts";
import type { CustomerFiles } from "./customer-files.ts";
import { customerNoteInputSchema, customerFileLimit, customerTotalFileLimit, type CustomerNote, type CustomerRecord, type CustomerAttachment } from "./customers.ts";

type UploadJournal = { hash: string; attachments: CustomerAttachment[]; createdAt: string };
export async function addCustomerNote(store: Store, shop: Shop, email: string, author: string, raw: unknown, files: CustomerFiles, token: string): Promise<CustomerNote> {
  const input = customerNoteInputSchema.parse(raw);
  const decoded = input.files.map(file => Buffer.from(file.data, "base64"));
  if (decoded.some((data, index) => data.length > customerFileLimit || data.toString("base64") !== input.files[index].data) || decoded.reduce((sum, data) => sum + data.length, 0) > customerTotalFileLimit)
    throw Object.assign(new Error(tr("添付は1ファイル5MB、合計10MB以内にしてください")), { status: 400 });
  const id = createHash("sha256").update(`${shop.id}:${email}:${author}:${input.requestId}`).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let journal = await store.get<UploadJournal>("customerNoteUpload", id);
  if (journal && journal.hash !== hash) throw Object.assign(new Error(tr("投稿内容が変わっています。新しい投稿として送信してください")), { status: 409 });
  if (!journal) {
    const ids = input.files.length ? await files.reserve(input.files.length, token) : [];
    if (ids.length !== input.files.length) throw new Error(tr("添付ファイルの保存先を作成できませんでした"));
    journal = { hash, createdAt: new Date().toISOString(), attachments: input.files.map((file, index) => ({ id: ids[index], name: file.name, mimeType: file.mimeType, size: decoded[index].length })) };
    // Persist reserved Drive identities before any upload. An interrupted request reuses them.
    await store.put("customerNoteUpload", id, journal);
  }
  let note = (await store.records<CustomerNote>("customerNote", shop)).find(note => note.id === id);
  if (!note) {
    for (const [index, file] of input.files.entries()) await files.upload(shop, token, journal.attachments[index].id, file);
    note = { id, shopId: shop.id, email, text: input.text, attachments: journal.attachments, createdAt: journal.createdAt, createdBy: author, updatedAt: journal.createdAt, updatedBy: author, status: "active" };
    await store.put("customerNote", id, note);
  }
  await touchCustomer(store, shop, email, note);
  return note;
}

export async function touchCustomer(store: Store, shop: Shop, email: string, note: CustomerNote) {
  const id = `${shop.id}:${email}`;
  const previous = await store.get<CustomerRecord>("customer", id);
  if (!previous || previous.updatedAt <= note.updatedAt) await store.put("customer", id, { ...previous, shopId: shop.id, email, updatedAt: note.updatedAt, updatedBy: note.updatedBy });
}
