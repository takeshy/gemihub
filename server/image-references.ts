import { tr } from "../shared/i18n.ts";
import type { ShopConfig } from "./domain.ts";
import { compilePresentation, themeImageIds, inlineThemeImages } from "../shared/presentation.ts";
const pageImages = (page: ShopConfig["pages"][number]) => compilePresentation({ html: page.body, css: page.css || "" }).imageIds;
const screenImages = (config: ShopConfig) => Object.values(config.screens || {}).flatMap(design => design ? compilePresentation(design).imageIds : []);
export function imageUses(config: ShopConfig | null, id: string): string[] {
  if (!config) return [];
  return [themeImageIds(config.appearance?.theme).includes(id) || screenImages(config).includes(id) ? tr("ページの雰囲気") : "", config.header.imageId === id ? tr("ヘッダー") : "", ...config.pages.filter(page => page.imageId === id || pageImages(page).includes(id)).map(page => tr("ページ：{0}", page.title)), ...config.menus.filter(menu => menu.imageId === id).map(menu => tr("メニュー：{0}", menu.name)), ...config.staff.filter(staff => staff.imageId === id).map(staff => tr("スタッフ：{0}", staff.name))].filter(Boolean);
}
export const managedImageIds = (config: ShopConfig) => [...new Set([
  config.header.imageId,
  ...themeImageIds(config.appearance?.theme),
  ...screenImages(config),
  ...config.pages.map(page => page.imageId),
  ...config.pages.flatMap(pageImages),
  ...config.staff.map(staff => staff.imageId),
  ...config.menus.filter(menu => menu.active).map(menu => menu.imageId),
].filter((id): id is string => !!id))];

/** Header and page hero images by URL; theme and body images resolve through `resolvedImages` when rendered. */
export function withImageSources(config: ShopConfig, sources: Record<string, string>): ShopConfig {
  const src = (id?: string) => id ? sources[id] : undefined;
  return { ...config, header: { ...config.header, imageUrl: src(config.header.imageId) || config.header.imageUrl }, pages: config.pages.map(page => ({ ...page, imageUrl: src(page.imageId) || page.imageUrl })) };
}
export function withInlineImages(config: ShopConfig, images: Record<string, { mimeType: string; data: string }> = {}): ShopConfig {
  const src = (id?: string) => id && images[id] ? `data:${images[id].mimeType};base64,${images[id].data}` : undefined;
  return { ...config, ...(config.appearance?.theme ? { appearance: { ...config.appearance, theme: inlineThemeImages(config.appearance.theme, images) } } : {}), header: { ...config.header, imageUrl: src(config.header.imageId) || config.header.imageUrl }, pages: config.pages.map(page => ({ ...page, imageUrl: src(page.imageId) || page.imageUrl })) };
}
