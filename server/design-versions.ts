import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import { shopSchema, type ShopConfig } from "./domain.ts";
import { artifacts } from "./artifacts.ts";
import { clients, createFolder, readDriveText, trashFile } from "./google.ts";
import type { Shop, Store } from "./store.ts";
import { managedImageIds } from "./image-references.ts";
import { screenIds } from "../shared/screens.ts";

// An allowlist: operational settings and all business records can never enter a version.
const designSchema = z.object({
  appearance: shopSchema.shape.appearance,
  screens: shopSchema.shape.screens,
  pages: shopSchema.shape.pages,
  header: shopSchema.shape.header,
  footer: shopSchema.shape.footer,
});
export type PublishedDesign = z.infer<typeof designSchema>;
export type DesignPublication = { number: number; at: string; summary: string; restoredFrom?: number };
/** Per-target content hashes, so a screen's history can be listed without reading every archive. */
export type DesignVersion = DesignPublication & { folderId: string; manifestId: string; imageIds?: string[]; fingerprints?: Record<string, string> };
type Manifest = { design: PublishedDesign; files: Record<string, string> };
export type DesignSnapshot = Manifest;
export const designOf = (config: ShopConfig): PublishedDesign => designSchema.parse(config);
export const sameDesign = (a: ShopConfig, b: ShopConfig) => isDeepStrictEqual(designOf(a), designOf(b));

/** One restorable part of the design: a built-in screen's layout, a custom page, or a shared part. */
export const designTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("screen"), screen: z.enum(screenIds) }),
  z.object({ kind: z.literal("page"), pageId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("part"), part: z.enum(["header", "footer"]) }),
]);
export type DesignTarget = z.infer<typeof designTargetSchema>;
export const targetKey = (target?: DesignTarget) => !target ? "all" : target.kind === "screen" ? `screen:${target.screen}` : target.kind === "page" ? `page:${target.pageId}` : `part:${target.part}`;
export function parseTargetKey(key: string): DesignTarget {
  const [kind, ...rest] = key.split(":"), value = rest.join(":");
  return designTargetSchema.parse(kind === "screen" ? { kind, screen: value } : kind === "page" ? { kind, pageId: value } : { kind, part: value });
}
/** The target's value in a design; undefined means the target does not exist (a page that was not created yet). */
function targetValue(design: PublishedDesign, target: DesignTarget): unknown {
  if (target.kind === "screen") return design.screens?.[target.screen] ?? null;
  if (target.kind === "part") return design[target.part];
  return design.pages.find(page => page.id === target.pageId);
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 22);
export function designFingerprints(config: ShopConfig | PublishedDesign): Record<string, string> {
  const design = designSchema.parse(config);
  const targets: DesignTarget[] = [...screenIds.map(screen => ({ kind: "screen" as const, screen })), { kind: "part", part: "header" }, { kind: "part", part: "footer" }, ...design.pages.map(page => ({ kind: "page" as const, pageId: page.id }))];
  return Object.fromEntries(targets.map(target => [targetKey(target), hash(targetValue(design, target))]));
}
// An archive never changes, so its index can be cached by manifest for the life of the process.
const legacyIndex = new Map<string, Record<string, string>>();
const legacyIndexLimit = 1000;
/**
 * Older archives have no index. Compute it from their manifest without changing stored history,
 * reading each archive once per process. A version whose archive cannot be read is left unindexed
 * (so it is not listed for a single screen) rather than failing the whole history; it is retried next time.
 */
export async function indexedDesignVersions(versions: DesignVersion[], storage: Pick<DesignVersionStorage, "readDesign">): Promise<DesignVersion[]> {
  return Promise.all(versions.map(async version => {
    if (version.fingerprints) return version;
    let fingerprints = legacyIndex.get(version.manifestId);
    if (!fingerprints) {
      try { fingerprints = designFingerprints(await storage.readDesign(version)); }
      catch (error) { console.error(error); return version; }
      if (legacyIndex.size >= legacyIndexLimit) legacyIndex.delete(legacyIndex.keys().next().value!);
      legacyIndex.set(version.manifestId, fingerprints);
    }
    return { ...version, fingerprints };
  }));
}
/**
 * Versions worth restoring for one target: one per distinct state that differs from now (the newest
 * version holding it). Versions without the target (a page that did not exist yet) are skipped.
 */
export function versionsFor<T extends DesignVersion>(versions: T[], current: ShopConfig, target?: DesignTarget): T[] {
  if (!target) return versions;
  const key = targetKey(target);
  const seen = new Set([designFingerprints(current)[key]]);
  return versions.filter(version => {
    const value = version.fingerprints?.[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
export function targetLabel(target: DesignTarget, design: PublishedDesign) {
  if (target.kind === "part") return target.part === "header" ? tr("ヘッダー") : tr("フッター");
  if (target.kind === "page") return design.pages.find(page => page.id === target.pageId)?.title || tr("ページ");
  return { reserve: tr("予約"), about: tr("お店のこと"), mine: tr("マイページ"), contact: tr("お問い合わせ") }[target.screen];
}
export function restoreDesign(current: ShopConfig, design: PublishedDesign, target?: DesignTarget): ShopConfig {
  // Assign optional keys too, so restoring a standard screen removes newer custom HTML.
  const saved = designSchema.parse(design);
  if (target) {
    const next = structuredClone(current);
    if (target.kind === "screen") {
      const screens = { ...(current.screens || {}) };
      const value = saved.screens?.[target.screen];
      if (value) screens[target.screen] = value; else delete screens[target.screen];
      next.screens = screens;
    } else if (target.kind === "part") next[target.part] = saved[target.part] as never;
    else {
      const page = saved.pages.find(item => item.id === target.pageId);
      if (!page) throw new Error(tr("この版にはこのページがありません"));
      const index = next.pages.findIndex(item => item.id === target.pageId);
      if (index >= 0) next.pages[index] = page; else next.pages.push(page);
    }
    return shopSchema.parse(next);
  }
  const restored = { ...current, appearance: saved.appearance, screens: saved.screens, pages: saved.pages, header: saved.header, footer: saved.footer };
  if (saved.appearance === undefined) delete restored.appearance;
  if (saved.screens === undefined) delete restored.screens;
  return shopSchema.parse(restored);
}
export const isDesignArtifact = (path: string) => /^web\/(?:index\.html|data\.js|shop\.json|mock\.json|(?:pages|parts)\/[^/]+\.(?:html|json))$/.test(path);
const requiredPaths = ["web/index.html", "web/data.js", "web/shop.json", "web/mock.json"];
function validateSnapshot(value: DesignSnapshot): DesignSnapshot {
  if (!requiredPaths.every(path => path in value.files) || Object.entries(value.files).some(([path, text]) => !isDesignArtifact(path) || typeof text !== "string"))
    throw new Error(tr("版の公開ファイルが揃っていません"));
  return { design: designSchema.parse(value.design), files: value.files };
}
export interface DesignVersionStorage {
  /** Whether capture() can archive the current publication. */
  ready(shop: Shop): boolean;
  /** Returns null when there is nothing complete to archive (e.g. a shop published before Drive was connected). */
  capture(shop: Shop, publication: DesignPublication): Promise<Pick<DesignVersion, "folderId" | "manifestId"> | null>;
  readDesign(version: DesignVersion): Promise<PublishedDesign>;
  read(version: DesignVersion): Promise<DesignSnapshot>;
  trash(version: DesignVersion): Promise<void>;
}
export function driveDesignVersions(token: string): DesignVersionStorage {
  const { drive } = clients(token);
  const designIds = (shop: Shop) => Object.fromEntries(Object.entries(shop.google?.artifactIds || {}).filter(([path]) => isDesignArtifact(path)));
  const ready = (shop: Shop) => !!shop.google && !!shop.published && requiredPaths.every(path => designIds(shop)[path]);
  return {
    ready,
    async capture(shop, publication) {
      if (!ready(shop)) return null;
      const ids = designIds(shop);
      const google = shop.google!;
      google.artifactFolders ||= {};
      const root = google.artifactFolders.designVersions ||= await createFolder(token, "design-versions", google.folderId);
      const folderId = await createFolder(token, `version-${publication.number}`, root);
      try {
        const files: Record<string, string> = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([path, id]) =>
          [path, (await drive.files.copy({ fileId: id, requestBody: { name: path.replaceAll("/", "__"), parents: [folderId] }, fields: "id" })).data.id!] as const)));
        const manifest: Manifest = { design: designOf(shop.published!), files };
        const manifestId = (await drive.files.create({ requestBody: { name: "manifest.json", parents: [folderId] }, media: { mimeType: "application/json", body: Readable.from([JSON.stringify(manifest)]) }, fields: "id" })).data.id!;
        return { folderId, manifestId };
      } catch (error) {
        await trashFile(token, folderId).catch(() => {});
        throw error;
      }
    },
    async readDesign(version) {
      const manifest = JSON.parse(await readDriveText(token, version.manifestId)) as Manifest;
      return designSchema.parse(manifest.design);
    },
    async read(version) {
      const manifest = JSON.parse(await readDriveText(token, version.manifestId)) as Manifest;
      // Read every file before overwriting anything; missing/corrupt archives fail safely.
      const files: Record<string, string> = {};
      for (const [path, id] of Object.entries(manifest.files)) {
        if (!isDesignArtifact(path) || typeof id !== "string") throw new Error(tr("版の公開ファイルが揃っていません"));
        files[path] = await readDriveText(token, id);
      }
      return validateSnapshot({ design: manifest.design, files });
    },
    trash: version => trashFile(token, version.folderId),
  };
}

/** Local, credential-free demo only. Judge/production shops always use the owner's Drive. */
export function demoDesignVersions(store: Store): DesignVersionStorage {
  return {
    ready: shop => !!shop.published,
    async capture(shop, publication) {
      const id = `${shop.id}:${publication.number}`;
      const files = Object.fromEntries(Object.entries(artifacts(shop.published!, await readFile("dist/index.html", "utf8"))).filter(([path]) => isDesignArtifact(path)));
      await store.put("designVersion", id, { design: designOf(shop.published!), files });
      return { folderId: id, manifestId: id };
    },
    async readDesign(version) { return designSchema.parse((await store.get<DesignSnapshot>("designVersion", version.manifestId))!.design); },
    async read(version) { return validateSnapshot((await store.get<DesignSnapshot>("designVersion", version.manifestId))!); },
    async trash(version) { await store.delete("designVersion", version.manifestId); },
  };
}

export function currentDesignPublication(shop: Shop): DesignPublication {
  const previous = shop.history.at(-1);
  return shop.designPublication || { number: 1, at: previous?.at || new Date().toISOString(), summary: previous?.summary || tr("公開済みのデザイン") };
}
/**
 * Persist the complete backup before the first public write. The operation marker makes retries safe.
 * `required` (restores) refuses to continue without a backup; publications may skip it.
 */
export async function preserveDesignVersion(shop: Shop, operationId: string, storage: DesignVersionStorage, save: () => Promise<void>, required = false) {
  if (!shop.published || shop.designBackupOperationId === operationId) return;
  const publication = currentDesignPublication(shop);
  const files = await storage.capture(shop, publication);
  if (!files && required) throw new Error(tr("復元前の状態を版履歴に保存できませんでした"));
  if (files) {
    const imageIds = managedImageIds({ ...shop.published, menus: [], staff: [] });
    shop.designVersions = [{ ...publication, ...files, imageIds, fingerprints: designFingerprints(shop.published) }, ...(shop.designVersions || [])];
  }
  shop.designBackupOperationId = operationId;
  await save();
}
export function nextDesignPublication(shop: Shop, at: string, summary: string, restoredFrom?: number) {
  const number = Math.max(shop.designPublication?.number || (shop.published ? 1 : 0), ...((shop.designVersions || []).map(version => version.number))) + 1;
  shop.designPublication = { number, at, summary, ...(restoredFrom === undefined ? {} : { restoredFrom }) };
}
/** Commit retirement with the new publication; trash only after the restore is durable. */
export function retireDesignVersions(shop: Shop) {
  const retired = (shop.designVersions || []).slice(10);
  if (!retired.length) return;
  shop.designVersions = shop.designVersions!.slice(0, 10);
  shop.designVersionTrash = [...(shop.designVersionTrash || []), ...retired];
}
export async function pruneDesignVersions(shop: Shop, storage: DesignVersionStorage, save: () => Promise<void>) {
  for (const version of [...(shop.designVersionTrash || [])]) {
    await storage.trash(version);
    shop.designVersionTrash = shop.designVersionTrash!.filter(item => item.folderId !== version.folderId);
    await save();
  }
}
