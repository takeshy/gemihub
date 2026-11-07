import { tr } from "../shared/i18n.ts";
import { createHash } from "node:crypto";
import type { Store, Shop } from "./store.ts";
import { checkedFileSizes, reserveAttachments, withAttachmentHashes, type CustomerFiles } from "./customer-files.ts";
import { customerNoteInputSchema, type CustomerNote, type CustomerRecord, type CustomerAttachment } from "./customers.ts";

type UploadJournal = { hash: string; attachments: CustomerAttachment[]; createdAt: string };
export async function addCustomerNote(store: Store, shop: Shop, email: string, author: string, raw: unknown, files: CustomerFiles, token: string): Promise<CustomerNote> {
  const input = customerNoteInputSchema.parse(raw);
  const sizes = checkedFileSizes(input.files);
  const id = createHash("sha256").update(`${shop.id}:${email}:${author}:${input.requestId}`).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let journal = await store.get<UploadJournal>("customerNoteUpload", id);
  if (journal && journal.hash !== hash) throw Object.assign(new Error(tr("投稿内容が変わっています。新しい投稿として送信してください")), { status: 409 });
  if (!journal) {
    journal = { hash, createdAt: new Date().toISOString(), attachments: await reserveAttachments(files, token, input.files, sizes) };
    // Persist reserved Drive identities before any upload. An interrupted request reuses them.
    await store.put("customerNoteUpload", id, journal);
  }
  let note = (await store.records<CustomerNote>("customerNote", shop)).find(note => note.id === id);
  if (!note) {
    for (const [index, file] of input.files.entries()) await files.upload(shop, token, journal.attachments[index].id, file);
    note = { id, shopId: shop.id, email, text: input.text, attachments: withAttachmentHashes(journal.attachments, input.files), createdAt: journal.createdAt, createdBy: author, updatedAt: journal.createdAt, updatedBy: author, status: "active" };
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
