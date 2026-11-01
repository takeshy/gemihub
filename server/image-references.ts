import type { ShopConfig } from "./domain.ts";
export function imageUses(config: ShopConfig | null, id: string): string[] {
  if (!config) return [];
  return [config.header.imageId === id ? "ヘッダー" : "", ...config.pages.filter(page => page.imageId === id).map(page => `ページ：${page.title}`), ...config.menus.filter(menu => menu.imageId === id).map(menu => `メニュー：${menu.name}`), ...config.staff.filter(staff => staff.imageId === id).map(staff => `スタッフ：${staff.name}`)].filter(Boolean);
}
export const managedImageIds = (config: ShopConfig) => [...new Set([
  config.header.imageId,
  ...config.pages.map(page => page.imageId),
  ...config.staff.map(staff => staff.imageId),
  ...config.menus.filter(menu => menu.active).map(menu => menu.imageId),
].filter((id): id is string => !!id))];

export function withInlineImages(config: ShopConfig, images: Record<string, { mimeType: string; data: string }> = {}): ShopConfig {
  const src = (id?: string) => id && images[id] ? `data:${images[id].mimeType};base64,${images[id].data}` : undefined;
  return { ...config, header: { ...config.header, imageUrl: src(config.header.imageId) || config.header.imageUrl }, pages: config.pages.map(page => ({ ...page, imageUrl: src(page.imageId) || page.imageUrl })) };
}
