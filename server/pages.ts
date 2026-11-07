import { tr } from "../shared/i18n.ts";
import { z } from "zod";
import type { ShopConfig } from "./domain.ts";
import { defaultAppearance, standardTheme, themeHtmlKey } from "../shared/theme-editing.ts";
import type { Theme } from "../shared/presentation.ts";
import { stableJson } from "../shared/stable-json.ts";
export const defaultHeader = { title: "", subtitle: "", imageUrl: "", showDetails: true, showNavigation: true };
export const defaultFooter = { text: "", alignment: "center" as const };
export const headerSchema = z.object({ title: z.string().max(100), subtitle: z.string().max(1500), imageUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2048)]), imageId: z.string().regex(/^[a-f0-9]{64}$/).optional(), showDetails: z.boolean(), showNavigation: z.boolean() });
export const footerSchema = z.object({ text: z.string().max(4000), alignment: z.enum(["left", "center"]) });
export const headerPartSchema = headerSchema.extend({ themeHtml: z.string().min(1).max(20000).optional() });
export const footerPartSchema = footerSchema.extend({ themeHtml: z.string().min(1).max(20000).optional() });
export const pageSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/).max(80),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  title: z.string().trim().min(1).max(100),
  navigationLabel: z.string().trim().min(1).max(40),
  /** A checked HTML fragment (no scripts, handlers, forms or embeds); `css` applies only to this page. */
  body: z.string().max(20000),
  css: z.string().max(12000).optional(),
  layout: z.enum(["standard", "compact"]),
  imageUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2048)]),
  imageId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type ShopPage = z.infer<typeof pageSchema>;
export const releaseScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), pageId: z.string().min(1) }),
  z.object({ kind: z.literal("shared") }),
  z.object({ kind: z.literal("part"), part: z.enum(["header", "footer"]) }),
]);
export type ReleaseScope = z.infer<typeof releaseScopeSchema>;
export const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
export const pageValue = (config: ShopConfig | null, id: string) => config?.pages.find(p => p.id === id) || null;
export function partValue(config: Pick<ShopConfig, "header" | "footer" | "appearance">, part: "header" | "footer") {
  return { ...config[part], themeHtml: (config.appearance?.theme || standardTheme)[themeHtmlKey(part)] };
}
export function replacePart(config: ShopConfig, part: "header" | "footer", value: unknown): ShopConfig {
  const parsed = (part === "header" ? headerPartSchema : footerPartSchema).parse(value);
  const { themeHtml, ...content } = parsed;
  const next = { ...config, [part]: content };
  if (themeHtml !== undefined && (config.appearance?.theme || themeHtml !== standardTheme[themeHtmlKey(part)])) {
    next.appearance = { ...(config.appearance || defaultAppearance), theme: { ...(config.appearance?.theme || standardTheme), [themeHtmlKey(part)]: themeHtml } };
  }
  return next;
}
// Shared edits own the frame and common CSS; each part owns its own HTML.
export function replaceShared(config: ShopConfig, value: unknown): ShopConfig {
  if (value === null) return config;
  const shared = value as Partial<ShopConfig>;
  const appearance: NonNullable<ShopConfig["appearance"]> = shared.appearance || defaultAppearance;
  const incoming = appearance.theme || standardTheme;
  const theme: Theme = { ...(config.appearance?.theme || standardTheme), bodyHtml: incoming.bodyHtml, css: incoming.css };
  const nextAppearance: NonNullable<ShopConfig["appearance"]> = { ...appearance };
  delete nextAppearance.theme;
  if (config.appearance?.theme || theme.bodyHtml !== standardTheme.bodyHtml || theme.css !== standardTheme.css) nextAppearance.theme = theme;
  const next = { ...config, ...shared, appearance: !config.appearance && same(nextAppearance, defaultAppearance) ? undefined : nextAppearance };
  // A scope is a complete value. An omitted optional setting means the default,
  // so a comparison or restore must not retain the other side's custom screen.
  for (const key of ["map", "screens", "ownerBooking"] as const) if (shared[key] === undefined) delete next[key];
  return next;
}
export function scopedSource(config: ShopConfig | null, scope: ReleaseScope) {
  if (!config) return null;
  if (scope.kind === "part") return partValue(config, scope.part);
  if (scope.kind === "page") return pageValue(config, scope.pageId);
  const { header: _header, footer: _footer, pages: _, menus: _m, staff: _s, hours: _h, rules: _r, region: _region, ...shared } = config;
  const appearance: NonNullable<ShopConfig["appearance"]> = config.appearance || defaultAppearance;
  return { ...shared, appearance: { ...appearance, theme: { ...standardTheme, bodyHtml: appearance.theme?.bodyHtml || standardTheme.bodyHtml, css: appearance.theme?.css || "" } } };
}
export function scopedConfig(current: ShopConfig | null, local: ShopConfig, scope: ReleaseScope): ShopConfig {
  if (scope.kind === "shared") return replaceShared(current || { ...local, appearance: undefined, pages: [], header: { ...defaultHeader }, footer: { ...defaultFooter } }, scopedSource(local, scope));
  if (!current) throw Object.assign(new Error(tr("先にお店の共通設定を本番に反映してください")), { status: 409 });
  if (scope.kind === "part") return replacePart(current, scope.part, partValue(local, scope.part));
  const page = pageValue(local, scope.pageId);
  const exists = current.pages.some(p => p.id === scope.pageId);
  const pages = page ? (exists ? current.pages.map(p => p.id === scope.pageId ? page : p) : [...current.pages, page]) : current.pages.filter(p => p.id !== scope.pageId);
  return { ...current, pages };
}
// Preserve unsaved changes and their original baselines for conflict checks.
export function rebaseDraft(before: ShopConfig | null, local: ShopConfig, published: ShopConfig, scope: ReleaseScope) {
  let config = structuredClone(published);
  let source = structuredClone(published);
  if (scope.kind !== "shared" && !same(scopedSource(local, { kind: "shared" }), scopedSource(before, { kind: "shared" }))) {
    config = replaceShared(config, scopedSource(local, { kind: "shared" }));
    if (before) source = replaceShared(source, scopedSource(before, { kind: "shared" }));
  }
  for (const part of ["header", "footer"] as const) {
    if (!(scope.kind === "part" && scope.part === part) && !same(partValue(local, part), before && partValue(before, part))) {
      config = replacePart(config, part, partValue(local, part));
      source = replacePart(source, part, partValue(before || published, part));
    }
  }
  const ids = [...new Set([...published.pages, ...local.pages, ...(before?.pages || [])].map(p => p.id))];
  config.pages = []; source.pages = [];
  for (const id of ids) {
    const previous = pageValue(before, id), edited = pageValue(local, id), live = pageValue(published, id);
    const keepLocal = !(scope.kind === "page" && scope.pageId === id) && !same(previous, edited);
    const next = keepLocal ? edited : live, baseline = keepLocal ? previous : live;
    if (next) config.pages.push(next);
    if (baseline) source.pages.push(baseline);
  }
  return { config, source };
}
