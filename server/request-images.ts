import type { Part } from "@google/genai";
import type { Store, Shop } from "./store.ts";
import type { CustomerFiles } from "./customer-files.ts";
import type { ShopConfig } from "./domain.ts";
import type { ShopPage } from "./pages.ts";
import { readMenuImage, type ImageUpload } from "./menu-images.ts";
import { requestImageIdsSchema } from "./image-library-domain.ts";

export type RequestImage = { id: string; name: string; mimeType: string; data: string };
export async function readRequestImages(store: Store, shop: Shop, raw: unknown, files: CustomerFiles, token: string): Promise<RequestImage[]> {
  const ids = requestImageIdsSchema.parse(raw || []);
  const images = await Promise.all(ids.map(async id => {
    const image = await readMenuImage(store, shop, id, files, token);
    const record = (await store.get<ImageUpload>("menuImageUpload", id))!;
    return { id, name: record.name || `画像-${id.slice(0, 8)}`, ...image };
  }));
  if (images.reduce((sum, image) => sum + Buffer.byteLength(image.data, "base64"), 0) > 10 * 1024 * 1024) throw Object.assign(new Error("依頼の画像は合計10MB以内にしてください。"), { status: 400 });
  return images;
}
export function requestImageParts(input: unknown, images: RequestImage[] = []): Part[] {
  return [{ text: JSON.stringify(input) }, ...images.flatMap(image => [{ text: `依頼で選択された画像：${JSON.stringify({ id: image.id, name: image.name })}` }, { inlineData: { mimeType: image.mimeType, data: image.data } }])];
}
export const requestImageInstruction = "選択された画像の見た目も確認する。画像を使う依頼では、選択画像のidを対象のheader.imageId・pages[].imageId・menus[].imageIdに設定し、imageUrlは空文字にする。画像の識別子やURLは捏造しない。指示された場所だけを変更し、選択しただけでは公開しない。";
const allIds = (config: ShopConfig | null) => config ? [config.header.imageId, ...config.pages.map(page => page.imageId), ...config.menus.map(menu => menu.imageId)].filter((id): id is string => !!id) : [];
export function validateProposedImages(config: ShopConfig, current: ShopConfig | null, images: RequestImage[]) {
  const allowed = new Set([...allIds(current), ...images.map(image => image.id)]);
  if (allIds(config).some(id => !allowed.has(id))) throw Object.assign(new Error("依頼で選択していない画像が提案されました。画像を選び直して依頼してください。"), { status: 400 });
}
export function validatePageImage(page: Omit<ShopPage, "id"> | null, images: RequestImage[]) {
  if (page?.imageId && !images.some(image => image.id === page.imageId)) throw Object.assign(new Error("依頼で選択していない画像が提案されました。"), { status: 400 });
}
