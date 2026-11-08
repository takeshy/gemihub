import { tr } from "../shared/i18n.ts";
import { z } from "zod";
import type { ShopConfig } from "./domain.ts";
import { compactTheme, defaultAppearance, standardTheme, themeHtmlKey } from "../shared/theme-editing.ts";
import type { Theme } from "../shared/presentation.ts";
import { stableJson } from "../shared/stable-json.ts";
import { headerCopyKeys, storefrontCopySchema, type StorefrontCopy } from "../shared/storefront-copy.ts";
export const defaultHeader = { title: "", subtitle: "", imageUrl: "", showDetails: true, showNavigation: true };
export const defaultFooter = { text: "", alignment: "center" as const };
export const headerSchema = z.object({ title: z.string().max(100), subtitle: z.string().max(1500), imageUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2048)]), imageId: z.string().regex(/^[a-f0-9]{64}$/).optional(), showDetails: z.boolean(), showNavigation: z.boolean() });
export const footerSchema = z.object({ text: z.string().max(4000), alignment: z.enum(["left", "center"]) });
export const headerPartSchema = headerSchema.extend({ themeHtml: z.string().min(1).max(20000).optional(), themeCss: z.string().max(12000).optional(), copy: storefrontCopySchema.optional() });
export const footerPartSchema = footerSchema.extend({ themeHtml: z.string().min(1).max(20000).optional(), themeCss: z.string().max(12000).optional() });
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
  z.object({ kind: z.literal("theme") }),
  z.object({ kind: z.literal("content") }),
  z.object({ kind: z.literal("part"), part: z.enum(["header", "footer"]) }),
]);
export type ReleaseScope = z.infer<typeof releaseScopeSchema>;
export const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
export const pageValue = (config: ShopConfig | null, id: string) => config?.pages.find(p => p.id === id) || null;
/** The whole-page frame owns presentation, never business facts or article feature switches. */
export function themeValue(config: Pick<ShopConfig, "header" | "footer" | "appearance">) {
  const current: NonNullable<ShopConfig["appearance"]> = config.appearance || defaultAppearance;
  const { articles: _, copy, ...rest } = current;
  const headerCopy = Object.fromEntries(headerCopyKeys.filter(key => copy?.[key] !== undefined).map(key => [key, copy![key]]));
  const appearance: Omit<NonNullable<ShopConfig["appearance"]>, "articles"> = { ...rest, ...(Object.keys(headerCopy).length ? { copy: headerCopy } : {}) };
  return { header: config.header, footer: config.footer, appearance: { ...appearance, theme: appearance.theme || standardTheme } };
}
export function replaceTheme(config: ShopConfig, value: unknown): ShopConfig {
  if (!value) return config;
  const incoming = value as ReturnType<typeof themeValue>;
  const copy = { ...config.appearance?.copy };
  for (const key of headerCopyKeys) { if (incoming.appearance.copy?.[key] !== undefined) copy[key] = incoming.appearance.copy[key]; else delete copy[key]; }
  const { copy: _copy, ...design } = incoming.appearance;
  const appearance = same(incoming.appearance, themeValue(config).appearance) ? config.appearance : { ...design, ...(Object.keys(copy).length ? { copy } : {}), ...(config.appearance?.articles ? { articles: config.appearance.articles } : {}) };
  if (appearance && !config.appearance?.articles) delete (appearance as NonNullable<ShopConfig["appearance"]>).articles;
  return { ...config, header: incoming.header, footer: incoming.footer, appearance };
}
/** Content edits cannot publish an unrelated whole-page frame draft. */
export function replaceContent(config: ShopConfig, value: unknown): ShopConfig {
  return replaceTheme(replaceShared(config, value), themeValue(config));
}
export function partValue(config: Pick<ShopConfig, "header" | "footer" | "appearance">, part: "header" | "footer") {
  const copy = Object.fromEntries(headerCopyKeys.filter(key => config.appearance?.copy?.[key] !== undefined).map(key => [key, config.appearance!.copy![key]]));
  return { ...config[part], themeHtml: (config.appearance?.theme || standardTheme)[themeHtmlKey(part)],
    ...(config.appearance?.theme?.[`${part}Css`] ? { themeCss: config.appearance.theme[`${part}Css`] } : {}),
    ...(part === "header" && Object.keys(copy).length ? { copy } : {}) };
}
export function replacePart(config: ShopConfig, part: "header" | "footer", value: unknown): ShopConfig {
  const parsed = (part === "header" ? headerPartSchema : footerPartSchema).parse(value);
  const { themeHtml, themeCss, ...rest } = parsed;
  const { copy, ...content } = rest as typeof rest & { copy?: StorefrontCopy };
  const next = { ...config, [part]: content };
  if (themeHtml !== undefined && (config.appearance?.theme || themeCss || themeHtml !== standardTheme[themeHtmlKey(part)])) {
    const theme = { ...(config.appearance?.theme || standardTheme), [themeHtmlKey(part)]: themeHtml };
    if (themeCss) theme[`${part}Css`] = themeCss; else delete theme[`${part}Css`];
    next.appearance = { ...(config.appearance || defaultAppearance), theme };
  }
  if (part === "header") {
    const merged = { ...next.appearance?.copy };
    for (const key of headerCopyKeys) { if (copy?.[key] !== undefined) merged[key] = copy[key]; else delete merged[key]; }
    if (!same(next.appearance?.copy || {}, merged)) {
      if (Object.keys(merged).length) next.appearance = { ...(next.appearance || defaultAppearance), copy: merged };
      else if (next.appearance?.copy) { next.appearance = { ...next.appearance }; delete next.appearance.copy; }
    }
  }
  return next;
}
/** The header owns navigation copy: other scopes keep the owner's values, set or unset. */
export function withHeaderCopy<T extends { copy?: StorefrontCopy }>(appearance: T, owner: StorefrontCopy | undefined): T {
  const next = { ...appearance };
  const copy = { ...appearance.copy };
  for (const key of headerCopyKeys) { if (owner?.[key] !== undefined) copy[key] = owner[key]; else delete copy[key]; }
  if (Object.keys(copy).length) next.copy = copy; else delete next.copy;
  return next;
}
/** Parts own their HTML and CSS: a shared edit can change only the frame and common CSS of a theme. */
export function withPartTheme<T extends { theme?: Theme }>(appearance: T, owner: Theme | undefined): T {
  if (!appearance.theme) return appearance;
  const { headerHtml, footerHtml, headerCss, footerCss } = owner || standardTheme;
  return { ...appearance, theme: compactTheme({ ...appearance.theme, headerHtml, footerHtml, headerCss, footerCss }) };
}
// Shared edits own the frame and common CSS; parts own their HTML/CSS, and the header owns navigation copy.
export function replaceShared(config: ShopConfig, value: unknown): ShopConfig {
  if (value === null) return config;
  const shared = value as Partial<ShopConfig>;
  const appearance: NonNullable<ShopConfig["appearance"]> = shared.appearance || defaultAppearance;
  const incoming = appearance.theme || standardTheme;
  const theme: Theme = compactTheme({ ...(config.appearance?.theme || standardTheme), bodyHtml: incoming.bodyHtml, css: incoming.css, styles: incoming.styles, bodyCss: incoming.bodyCss, frame: incoming.frame });
  const nextAppearance = withHeaderCopy(appearance, config.appearance?.copy);
  delete nextAppearance.theme;
  if (config.appearance?.theme || theme.bodyHtml !== standardTheme.bodyHtml || theme.css !== standardTheme.css || theme.styles?.length || theme.bodyCss || theme.frame) nextAppearance.theme = theme;
  const next = { ...config, ...shared, appearance: !config.appearance && same(nextAppearance, defaultAppearance) ? undefined : nextAppearance };
  // A scope is a complete value. An omitted optional setting means the default,
  // so a comparison or restore must not retain the other side's custom screen.
  for (const key of ["map", "screens", "ownerBooking"] as const) if (shared[key] === undefined) delete next[key];
  return next;
}
export function scopedSource(config: ShopConfig | null, scope: ReleaseScope) {
  if (!config) return null;
  if (scope.kind === "theme") return themeValue(config);
  if (scope.kind === "part") return partValue(config, scope.part);
  if (scope.kind === "page") return pageValue(config, scope.pageId);
  const { header: _header, footer: _footer, pages: _, menus: _m, staff: _s, hours: _h, rules: _r, region: _region, ...shared } = config;
  const appearance: NonNullable<ShopConfig["appearance"]> = config.appearance || defaultAppearance;
  const sharedAppearance = { ...appearance };
  const copy = { ...appearance.copy };
  for (const key of headerCopyKeys) delete copy[key];
  if (Object.keys(copy).length) sharedAppearance.copy = copy; else delete sharedAppearance.copy;
  if (scope.kind === "content") return { ...shared, appearance: { ...defaultAppearance, ...(Object.keys(copy).length ? { copy } : {}), ...(config.appearance?.articles ? { articles: config.appearance.articles } : {}) } };
  return { ...shared, appearance: { ...sharedAppearance, theme: { ...standardTheme, bodyHtml: appearance.theme?.bodyHtml || standardTheme.bodyHtml, css: appearance.theme?.css || "", ...(appearance.theme?.frame ? { frame: true } : {}), ...(appearance.theme?.styles ? { styles: appearance.theme.styles } : {}), ...(appearance.theme?.bodyCss ? { bodyCss: appearance.theme.bodyCss } : {}) } } };
}
export function scopedConfig(current: ShopConfig | null, local: ShopConfig, scope: ReleaseScope): ShopConfig {
  if (scope.kind === "content") return replaceContent(current || local, scopedSource(local, scope));
  if (scope.kind === "theme") {
    if (!current) throw Object.assign(new Error(tr("先にお店の共通設定を本番に反映してください")), { status: 409 });
    return replaceTheme(current, themeValue(local));
  }
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
    if (scope.kind === "content") {
      config = replaceTheme(config, themeValue(local));
      if (before) source = replaceTheme(source, themeValue(before));
    } else {
      config = replaceShared(config, scopedSource(local, { kind: "shared" }));
      if (before) source = replaceShared(source, scopedSource(before, { kind: "shared" }));
      if (scope.kind === "theme") { config = replaceTheme(config, themeValue(published)); source = replaceTheme(source, themeValue(published)); }
    }
  }
  for (const part of ["header", "footer"] as const) {
    if (scope.kind !== "theme" && !(scope.kind === "part" && scope.part === part) && !same(partValue(local, part), before && partValue(before, part))) {
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
