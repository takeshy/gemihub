import { z } from "zod";
import type { ShopConfig } from "./domain.ts";
export const defaultHeader = { title: "", subtitle: "", imageUrl: "", showDetails: true, showNavigation: true };
export const defaultFooter = { text: "", alignment: "center" as const };
export const headerSchema = z.object({ title: z.string().max(100), subtitle: z.string().max(1500), imageUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2048)]), imageId: z.string().regex(/^[a-f0-9]{64}$/).optional(), showDetails: z.boolean(), showNavigation: z.boolean() });
export const footerSchema = z.object({ text: z.string().max(4000), alignment: z.enum(["left", "center"]) });
export const pageSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/).max(80),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  title: z.string().trim().min(1).max(100),
  navigationLabel: z.string().trim().min(1).max(40),
  body: z.string().max(20000),
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
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const pageValue = (config: ShopConfig | null, id: string) => config?.pages.find(p => p.id === id) || null;
export function scopedSource(config: ShopConfig | null, scope: ReleaseScope) {
  if (!config) return null;
  if (scope.kind === "part") return config[scope.part];
  if (scope.kind === "page") return pageValue(config, scope.pageId);
  const { header: _header, footer: _footer, pages: _, menus: _m, staff: _s, hours: _h, rules: _r, ...shared } = config;
  return shared;
}
export function scopedConfig(current: ShopConfig | null, local: ShopConfig, scope: ReleaseScope): ShopConfig {
  if (scope.kind === "shared") return current ? { ...current, ...scopedSource(local, scope) as object, appearance: local.appearance } : { ...local, pages: [], header: { ...defaultHeader }, footer: { ...defaultFooter } };
  if (!current) throw Object.assign(new Error("先にお店の共通設定を本番に反映してください"), { status: 409 });
  if (scope.kind === "part") return { ...current, [scope.part]: local[scope.part] };
  const page = pageValue(local, scope.pageId);
  const exists = current.pages.some(p => p.id === scope.pageId);
  const pages = page ? (exists ? current.pages.map(p => p.id === scope.pageId ? page : p) : [...current.pages, page]) : current.pages.filter(p => p.id !== scope.pageId);
  return { ...current, pages };
}
// Preserve unsaved changes and their original baselines for conflict checks.
export function rebaseDraft(before: ShopConfig | null, local: ShopConfig, published: ShopConfig, scope: ReleaseScope) {
  const config = structuredClone(published);
  const source = structuredClone(published);
  for (const key of ["name", "industry", "description", "address", "appearance", "notificationEmail"] as const) {
    if (scope.kind !== "shared" && !same(local[key], before?.[key])) {
      (config as Record<string, unknown>)[key] = local[key];
      if (before) (source as Record<string, unknown>)[key] = before[key];
    }
  }
  for (const part of ["header", "footer"] as const) {
    if (!(scope.kind === "part" && scope.part === part) && !same(local[part], before?.[part])) {
      if (part === "header") { config.header = local.header; source.header = before?.header || published.header; }
      else { config.footer = local.footer; source.footer = before?.footer || published.footer; }
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
