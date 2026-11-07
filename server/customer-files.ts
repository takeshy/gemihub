import { tr } from "../shared/i18n.ts";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { clients } from "./google.ts";
import type { Shop, Store } from "./store.ts";
import { customerFileLimit, customerTotalFileLimit, type CustomerAttachment } from "./customers.ts";

export type FileUpload = { name: string; mimeType: string; data: string };
export type CustomerFiles = {
  reserve(count: number, token: string): Promise<string[]>;
  upload(shop: Shop, token: string, id: string, file: FileUpload): Promise<void>;
  read(shop: Shop, token: string, id: string): Promise<Buffer>;
  rename(shop: Shop, token: string, id: string, name: string): Promise<void>;
};
export function checkedFileSizes(input: FileUpload[]) {
  const decoded = input.map(file => Buffer.from(file.data, "base64"));
  if (decoded.some((data, index) => data.length > customerFileLimit || data.toString("base64") !== input[index].data) || decoded.reduce((sum, data) => sum + data.length, 0) > customerTotalFileLimit)
    throw Object.assign(new Error(tr("添付は1ファイル5MB、合計10MB以内にしてください")), { status: 400 });
  return decoded.map(data => data.length);
}
export async function reserveAttachments(files: CustomerFiles, token: string, input: FileUpload[], sizes: number[]): Promise<CustomerAttachment[]> {
  const ids = input.length ? await files.reserve(input.length, token) : [];
  if (ids.length !== input.length) throw new Error(tr("添付ファイルの保存先を作成できませんでした"));
  return withAttachmentHashes(input.map((file, index) => ({ id: ids[index], name: file.name, mimeType: file.mimeType, size: sizes[index] })), input);
}
/** Input must match the upload journal before adding hashes to its legacy attachment metadata. */
export function withAttachmentHashes(attachments: CustomerAttachment[], input: FileUpload[]): CustomerAttachment[] {
  return attachments.map((file, index) => ({ ...file, sha256: file.sha256 ?? createHash("sha256").update(Buffer.from(input[index].data, "base64")).digest("hex") }));
}
export async function readAttachment(files: CustomerFiles, shop: Shop, token: string, attachment: CustomerAttachment) {
  const data = await files.read(shop, token, attachment.id);
  if (data.length !== attachment.size || attachment.sha256 && createHash("sha256").update(data).digest("hex") !== attachment.sha256)
    throw Object.assign(new Error(tr("添付ファイルが変更されています")), { status: 409 });
  return data;
}
/** The file is gone or was replaced, so retrying the read cannot succeed. */
export function attachmentUnavailable(error: unknown) {
  const { status, code, response } = error as { status?: number; code?: number; response?: { status?: number } };
  return [status, code, response?.status].some(value => value === 404 || value === 409);
}
export const googleCustomerFiles: CustomerFiles = {
  async reserve(count, token) {
    const { drive } = clients(token);
    const result = await drive.files.generateIds({ count, space: "drive", type: "files" });
    return result.data.ids!;
  },
  async upload(shop, token, id, file) {
    const { drive } = clients(token);
    const content = Buffer.from(file.data, "base64");
    const fingerprint = createHash("sha256").update(content).update(file.name).update(file.mimeType).digest("hex");
    try {
      await drive.files.create({
        requestBody: { id, name: file.name, mimeType: file.mimeType, parents: [shop.google!.folderId], appProperties: { crmShop: shop.id, crmContent: fingerprint } },
        media: { mimeType: file.mimeType, body: Readable.from([content]) }, fields: "id",
      });
    } catch (error) {
      if ((error as { response?: { status: number }; code?: number }).response?.status !== 409 && (error as { code?: number }).code !== 409) throw error;
      const existing = await drive.files.get({ fileId: id, fields: "appProperties,parents,trashed" });
      if (existing.data.trashed || existing.data.appProperties?.crmShop !== shop.id || existing.data.appProperties?.crmContent !== fingerprint || !existing.data.parents?.includes(shop.google!.folderId)) throw error;
    }
  },
  async read(_shop, token, id) {
    const { drive } = clients(token);
    const result = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "arraybuffer", maxContentLength: customerFileLimit });
    return Buffer.from(result.data as unknown as ArrayBuffer);
  },
  async rename(_shop, token, id, name) {
    const { drive } = clients(token);
    await drive.files.update({ fileId: id, requestBody: { name }, fields: "id" });
  },
};

export function memoryCustomerFiles(store: Store): CustomerFiles {
  return {
    async reserve(count) { return Array.from({ length: count }, () => randomUUID()); },
    async upload(shop, _token, id, file) { await store.put("demoCustomerFile", id, { ...file, shopId: shop.id }); },
    async read(shop, _token, id) {
      const file = await store.get<FileUpload & { shopId: string }>("demoCustomerFile", id);
      if (!file || file.shopId !== shop.id) throw Object.assign(new Error(tr("添付ファイルがありません")), { status: 404 });
      return Buffer.from(file.data, "base64");
    },
    async rename(shop, _token, id, name) {
      const file = await store.get<FileUpload & { shopId: string }>("demoCustomerFile", id);
      if (!file || file.shopId !== shop.id) throw Object.assign(new Error(tr("添付ファイルがありません")), { status: 404 });
      await store.put("demoCustomerFile", id, { ...file, name });
    },
  };
}
