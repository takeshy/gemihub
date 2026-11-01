import { postImageIds } from "./post-images.ts";
import type { Post } from "./post-domain.ts";
import { createHash } from "node:crypto";
import type { Shop, Store } from "./store.ts";
import type { ShopConfig } from "./domain.ts";
import type { CustomerFiles } from "./customer-files.ts";
import { uploadMenuImage, readMenuImage, type ImageUpload } from "./menu-images.ts";
import { managedImageIds, imageUses } from "./image-references.ts";
import { generateImageSchema, imageNameSchema, type LibraryImage } from "./image-library-domain.ts";
import { generateImage } from "./image-generation.ts";
import type { MenuImageData } from "./menu-image-domain.ts";
export async function listImages(store: Store, shop: Shop, config: ShopConfig | null): Promise<LibraryImage[]> {
  const posts=await store.records<Post>("post",shop);
  return (await store.entries<ImageUpload>("menuImageUpload")).flatMap(({ id, value }) => value.shopId === shop.id && value.complete && !value.archived ? [{
    id, name: value.name || `メニュー画像-${id.slice(0, 8)}`, mimeType: value.mimeType, size: value.size, createdAt: value.createdAt || "", source: value.source || "upload", prompt: value.prompt, model: value.model, usedBy: [...imageUses(config, id), ...posts.filter(post=>post.published&&postImageIds(post.published.body).includes(id)).map(post=>`記事：${post.published!.title}`)],
  }] : []).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export async function updateImage(store: Store, shop: Shop, id: string, raw: unknown, files: CustomerFiles, token: string) {
  const name = imageNameSchema.parse((raw as { name?: unknown })?.name);
  const image = await store.get<ImageUpload>("menuImageUpload", id);
  if (!image || image.shopId !== shop.id || !image.complete || image.archived) throw Object.assign(new Error("画像がありません"), { status: 404 });
  await files.rename(shop, token, image.fileId, name);
  await store.put("menuImageUpload", id, { ...image, name });
}
export async function archiveImage(store: Store, shop: Shop, id: string, config: ShopConfig | null) {
  const image = await store.get<ImageUpload>("menuImageUpload", id);
  if (!image || image.shopId !== shop.id || !image.complete) throw Object.assign(new Error("画像がありません"), { status: 404 });
  const posts=await store.records<Post>("post",shop);
  if (posts.some(post=>post.published&&postImageIds(post.published.body).includes(id)) || imageUses(config, id).length || config && managedImageIds(config).includes(id)) throw Object.assign(new Error("使用中の画像です。ページやメニューの画像を外して反映してから削除してください。"), { status: 409 });
  await store.put("menuImageUpload", id, { ...image, archived: true });
}
type Generation = { shopId: string; hash: string; state: "started" | "ready" | "done" | "failed"; imageId?: string; mimeType?: MenuImageData["mimeType"]; model?: string; chunks?: number; error?: string };
export async function generateLibraryImage(store: Store, shop: Shop, raw: unknown, files: CustomerFiles, token: string, generator: typeof generateImage = generateImage) {
  const input = generateImageSchema.parse(raw);
  const id = createHash("sha256").update(`${shop.id}:image-generation:${input.requestId}`).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let journal = await store.get<Generation>("imageGeneration", id);
  if (journal && journal.hash !== hash) throw Object.assign(new Error("生成の内容が変わっています。新しい画像として生成してください。"), { status: 409 });
  if (journal?.state === "done") { await readMenuImage(store, shop, journal.imageId!, files, token); return { imageId: journal.imageId! }; }
  if (journal?.state === "started") throw Object.assign(new Error("前回の生成結果を確認できません。画像一覧を確認し、必要なら新しい生成としてやり直してください。"), { status: 409 });
  if (journal?.state === "failed") throw Object.assign(new Error(journal.error || "生成に失敗しました。新しい生成としてやり直してください。"), { status: 422 });
  if (!journal) {
    const reference = input.referenceImageId ? await readMenuImage(store, shop, input.referenceImageId, files, token) : undefined;
    journal = { shopId: shop.id, hash, state: "started" };
    await store.put("imageGeneration", id, journal);
    let result: Awaited<ReturnType<typeof generateImage>>;
    try { result = await generator(input, reference); }
    catch (error) {
      await store.put("imageGeneration", id, { ...journal, state: "failed", error: error instanceof Error ? error.message : "画像を生成できませんでした。" });
      throw error;
    }
    // Keep each temporary recovery chunk below Firestore's document-size limit.
    const chunks = result.data.match(/.{1,400000}/g) || [];
    journal = { ...journal, state: "ready", chunks: chunks.length, mimeType: result.mimeType, model: result.model };
    await store.transaction(async () => {
      for (let index = 0; index < chunks.length; index++) await store.put("imageGenerationData", `${id}:${index}`, { data: chunks[index], expires: Date.now() + 86400000 });
      await store.put("imageGeneration", id, journal);
    });
  }
  const data = (await Promise.all(Array.from({ length: journal.chunks! }, async (_, index) => {
    const chunk = await store.get<{ data: string }>("imageGenerationData", `${id}:${index}`);
    if (!chunk) throw new Error("生成画像の保存を再開できません。画像一覧を確認してください。");
    return chunk.data;
  }))).join("");
  const result = await uploadMenuImage(store, shop, { requestId: input.requestId, name: input.name, mimeType: journal.mimeType, data }, files, token);
  const upload = (await store.get<ImageUpload>("menuImageUpload", result.imageId))!;
  await store.put("menuImageUpload", result.imageId, { ...upload, source: "ai", prompt: input.prompt, model: journal.model });
  await store.put("imageGeneration", id, { ...journal, state: "done", imageId: result.imageId });
  for (let index = 0; index < journal.chunks!; index++) await store.delete("imageGenerationData", `${id}:${index}`).catch(() => {});
  return result;
}
