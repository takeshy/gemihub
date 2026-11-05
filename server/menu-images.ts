import { tr } from "../shared/i18n.ts";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { ImageCache, ImageWork } from "./image-cache.ts";
import type { Store, Shop } from "./store.ts";
import type { ShopConfig } from "./domain.ts";
import type { CustomerFiles } from "./customer-files.ts";
import { menuImageInputSchema, menuImageLimit, type MenuImageData } from "./menu-image-domain.ts";
import { managedImageIds } from "./image-references.ts";

export type ImageUpload = { uploadedBy?: string; shopId: string; fileId: string; hash: string; mimeType: MenuImageData["mimeType"]; size: number; complete: boolean; name?: string; createdAt?: string; source?: "upload" | "ai"; prompt?: string; model?: string; archived?: boolean };
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
type ImageToken = string | (() => Promise<string>);
export type ImageView = "original" | "display" | "thumbnail";
const caches = new WeakMap<Store, { data: ImageCache<MenuImageData>; work: ImageWork }>();
function cacheFor(store: Store) {
  let cache = caches.get(store);
  if (!cache) { cache = { data: new ImageCache(), work: new ImageWork() }; caches.set(store, cache); }
  return cache;
}
const imageKey = (shop: Shop, imageId: string, upload: ImageUpload) => createHash("sha256").update(JSON.stringify([shop.id, imageId, upload.fileId, upload.hash, upload.size, upload.mimeType])).digest("hex");
const imageSize = (image: MenuImageData) => image.data.length + 100;
function animatedPng(bytes: Buffer) {
  for (let offset = 8; offset + 12 <= bytes.length; offset += bytes.readUInt32BE(offset) + 12) {
    if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
  }
  return false;
}
export async function uploadMenuImage(store: Store, shop: Shop, raw: unknown, files: CustomerFiles, token: string, author?: string) {
  const input = menuImageInputSchema.parse(raw);
  const bytes = Buffer.from(input.data, "base64");
  const valid = input.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : input.mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : input.mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid || bytes.length > menuImageLimit || bytes.toString("base64") !== input.data) fail(400, tr("5MB以内のPNG・JPEG・GIF・WebP画像を選択してください"));
  const imageId = createHash("sha256").update(author ? `${shop.id}:staff-image:${author}:${input.requestId}` : `${shop.id}:menu-image:${input.requestId}`).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let upload = await store.get<ImageUpload>("menuImageUpload", imageId);
  if (upload && upload.hash !== hash) fail(409, tr("画像が変更されています。選び直してください"));
  if (!upload) {
    const [fileId] = await files.reserve(1, token);
    if (!fileId) throw new Error(tr("画像の保存先を作成できませんでした"));
    upload = { shopId: shop.id, fileId, hash, mimeType: input.mimeType, size: bytes.length, complete: false, name: input.name, createdAt: new Date().toISOString(), source: "upload", ...(author ? {uploadedBy:author} : {}) };
    await store.put("menuImageUpload", imageId, upload);
  }
  if (!upload.complete) {
    await files.upload(shop, token, upload.fileId, input);
    upload.complete = true;
    await store.put("menuImageUpload", imageId, upload);
  }
  await cacheFor(store).data.read(imageKey(shop, imageId, upload), async () => ({ mimeType: input.mimeType, data: input.data }), imageSize);
  return { imageId };
}
async function receipt(store: Store, shop: Shop, imageId: string) {
  const upload = await store.get<ImageUpload>("menuImageUpload", imageId);
  return upload?.complete && !upload.archived && upload.shopId === shop.id ? upload : fail(404, tr("画像がありません"));
}
/** Draft saves validate ownership in the database without downloading image bytes from Drive. */
export async function validateImageIds(store: Store, shop: Shop, ids: string[]) {
  await Promise.all(ids.map(id => receipt(store, shop, id)));
}
export async function validateMenuImages(store: Store, shop: Shop, config: ShopConfig) {
  for (const menu of config.menus) if (menu.imageId) await receipt(store, shop, menu.imageId);
  for (const id of managedImageIds(config)) await receipt(store, shop, id);
}
export async function menuImageResource(store: Store, shop: Shop, imageId: string, files: CustomerFiles, token: ImageToken, view: ImageView = "original") {
  const upload = await receipt(store, shop, imageId);
  const cache = cacheFor(store);
  const key = imageKey(shop, imageId, upload);
  const original = () => cache.data.read(key, () => cache.work.run(async () => {
    const bytes = await files.read(shop, typeof token === "function" ? await token() : token, upload.fileId);
    if (bytes.length !== upload.size) fail(409, tr("メニュー画像が変更されています"));
    return { mimeType: upload.mimeType, data: bytes.toString("base64") };
  }), imageSize);
  const variant = `${key}:${view}:webp-v1`;
  return {
    etag: `"${variant}"`,
    read: () => view === "original" ? original() : cache.data.read(variant, async () => {
      const image = await original(), bytes = Buffer.from(image.data, "base64");
      return cache.work.run(async () => {
        try {
          if (image.mimeType === "image/png" && animatedPng(bytes)) return image;
          const metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
          // Preserve animation. The original is also the fallback for an undecodable image.
          if ((metadata.pages || 1) > 1) return image;
          const width = view === "thumbnail" ? 480 : 1600;
          const result = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize({ width, height: width, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 3 }).toBuffer();
          return result.length < bytes.length ? { mimeType: "image/webp" as const, data: result.toString("base64") } : image;
        } catch { return image; }
      });
    }, imageSize),
  };
}
export async function readMenuImage(store: Store, shop: Shop, imageId: string, files: CustomerFiles, token: ImageToken, view: ImageView = "original"): Promise<MenuImageData> {
  return (await menuImageResource(store, shop, imageId, files, token, view)).read();
}
export async function menuImageSnapshot(store: Store, shop: Shop, config: ShopConfig, files: CustomerFiles, token: string, extraIds: string[] = []) {
  const images: Record<string, MenuImageData> = {};
  for (const id of new Set([...managedImageIds(config), ...extraIds])) images[id] = await readMenuImage(store, shop, id, files, token);
  return images;
}
