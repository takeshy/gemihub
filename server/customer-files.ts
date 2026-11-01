import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { clients } from "./google.ts";
import type { Shop, Store } from "./store.ts";
import { customerFileLimit } from "./customers.ts";

export type FileUpload = { name: string; mimeType: string; data: string };
export type CustomerFiles = {
  reserve(count: number, token: string): Promise<string[]>;
  upload(shop: Shop, token: string, id: string, file: FileUpload): Promise<void>;
  read(shop: Shop, token: string, id: string): Promise<Buffer>;
  rename(shop: Shop, token: string, id: string, name: string): Promise<void>;
};
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
      if (!file || file.shopId !== shop.id) throw Object.assign(new Error("添付ファイルがありません"), { status: 404 });
      return Buffer.from(file.data, "base64");
    },
    async rename(shop, _token, id, name) {
      const file = await store.get<FileUpload & { shopId: string }>("demoCustomerFile", id);
      if (!file || file.shopId !== shop.id) throw Object.assign(new Error("添付ファイルがありません"), { status: 404 });
      await store.put("demoCustomerFile", id, { ...file, name });
    },
  };
}
