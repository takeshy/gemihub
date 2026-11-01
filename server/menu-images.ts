import { createHash } from "node:crypto";
import type { Store, Shop } from "./store.ts";
import type { ShopConfig } from "./domain.ts";
import type { CustomerFiles } from "./customer-files.ts";
import { menuImageInputSchema, menuImageLimit, type MenuImageData } from "./menu-image-domain.ts";
import { managedImageIds } from "./image-references.ts";

export type ImageUpload = { shopId: string; fileId: string; hash: string; mimeType: MenuImageData["mimeType"]; size: number; complete: boolean; name?: string; createdAt?: string; source?: "upload" | "ai"; prompt?: string; model?: string; archived?: boolean };
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
export async function uploadMenuImage(store: Store, shop: Shop, raw: unknown, files: CustomerFiles, token: string) {
  const input = menuImageInputSchema.parse(raw);
  const bytes = Buffer.from(input.data, "base64");
  const valid = input.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : input.mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : input.mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid || bytes.length > menuImageLimit || bytes.toString("base64") !== input.data) fail(400, "5MB以内のPNG・JPEG・GIF・WebP画像を選択してください");
  const imageId = createHash("sha256").update(`${shop.id}:menu-image:${input.requestId}`).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let upload = await store.get<ImageUpload>("menuImageUpload", imageId);
  if (upload && upload.hash !== hash) fail(409, "画像が変更されています。選び直してください");
  if (!upload) {
    const [fileId] = await files.reserve(1, token);
    if (!fileId) throw new Error("画像の保存先を作成できませんでした");
    upload = { shopId: shop.id, fileId, hash, mimeType: input.mimeType, size: bytes.length, complete: false, name: input.name, createdAt: new Date().toISOString(), source: "upload" };
    await store.put("menuImageUpload", imageId, upload);
  }
  if (!upload.complete) {
    await files.upload(shop, token, upload.fileId, input);
    upload.complete = true;
    await store.put("menuImageUpload", imageId, upload);
  }
  return { imageId };
}
async function receipt(store: Store, shop: Shop, imageId: string) {
  const upload = await store.get<ImageUpload>("menuImageUpload", imageId);
  return upload?.complete && !upload.archived && upload.shopId === shop.id ? upload : fail(404, "画像がありません");
}
export async function validateMenuImages(store: Store, shop: Shop, config: ShopConfig) {
  for (const menu of config.menus) if (menu.imageId) await receipt(store, shop, menu.imageId);
  for (const id of managedImageIds(config)) await receipt(store, shop, id);
}
export async function readMenuImage(store: Store, shop: Shop, imageId: string, files: CustomerFiles, token: string): Promise<MenuImageData> {
  const upload = await receipt(store, shop, imageId);
  const bytes = await files.read(shop, token, upload.fileId);
  if (bytes.length !== upload.size) fail(409, "メニュー画像が変更されています");
  return { mimeType: upload.mimeType, data: bytes.toString("base64") };
}
export async function menuImageSnapshot(store: Store, shop: Shop, config: ShopConfig, files: CustomerFiles, token: string) {
  const images: Record<string, MenuImageData> = {};
  for (const id of managedImageIds(config)) images[id] = await readMenuImage(store, shop, id, files, token);
  return images;
}
