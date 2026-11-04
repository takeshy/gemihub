import { Readable } from "node:stream";
import { google } from "googleapis";
import type { Store } from "./store.ts";

/** Immutable, content-addressed objects; the shop's Firestore record selects the completed release. */
export type StorefrontFiles = {
  write(path: string, body: string | Buffer, contentType: string): Promise<void>;
  read(path: string): Promise<Buffer | undefined>;
  /** Deleting a missing object is not an error. */
  remove(path: string): Promise<void>;
};

export function bucketStorefrontFiles(bucket = process.env.STOREFRONT_BUCKET): StorefrontFiles {
  const storage = google.storage({ version: "v1", auth: new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] }) });
  const requiredBucket = () => {
    if (!bucket) throw new Error("STOREFRONT_BUCKET is required to publish storefront pages");
    return bucket;
  };
  return {
    async write(path, body, contentType) {
      try {
        await storage.objects.insert({ bucket: requiredBucket(), name: path, ifGenerationMatch: "0", requestBody: { cacheControl: "private, no-store" }, media: { mimeType: contentType, body: Readable.from([typeof body === "string" ? Buffer.from(body) : body]) } });
      } catch (error) {
        // Paths are content-addressed, so an existing object already holds these bytes.
        if ((error as { code?: number }).code !== 412) throw error;
      }
    },
    async read(path) {
      try {
        const result = await storage.objects.get({ bucket: requiredBucket(), object: path, alt: "media" }, { responseType: "arraybuffer" });
        return Buffer.from(result.data as ArrayBuffer);
      } catch (error) {
        if ((error as { code?: number }).code === 404) return undefined;
        throw error;
      }
    },
    async remove(path) {
      try { await storage.objects.delete({ bucket: requiredBucket(), object: path }); }
      catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
    },
  };
}

export function memoryStorefrontFiles(store: Store): StorefrontFiles {
  return {
    async write(path, body, contentType) { await store.put("storefrontFile", path, { data: Buffer.from(body).toString("base64"), contentType }); },
    async read(path) { const file = await store.get<{ data: string }>("storefrontFile", path); return file ? Buffer.from(file.data, "base64") : undefined; },
    async remove(path) { await store.delete("storefrontFile", path); },
  };
}
