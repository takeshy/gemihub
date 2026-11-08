import { tr } from "../shared/i18n";
import { pageValue, scopedSource, same, replacePart, replaceShared, replaceTheme, replaceContent, type ReleaseScope } from "../server/pages";
import { sha256 } from "@noble/hashes/sha2.js";
import type { EditorIndex } from "../server/editor-index-schema";
import type { LocalDraft } from "./local-preview";
import { stableJson } from "../shared/stable-json";
export type SyncStatus = "unfetched" | "synced" | "local" | "remote" | "conflict";
export async function fingerprint(value: unknown) {
  // Match the server's SHA-256 without requiring a secure browser context.
  const bytes = sha256(new TextEncoder().encode(stableJson(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
export async function syncStatus(draft: LocalDraft, index: EditorIndex, scope: ReleaseScope): Promise<SyncStatus> {
  const id = scope.kind === "page" ? scope.pageId : scope.kind === "part" ? `part:${scope.part}` : scope.kind === "theme" ? "theme" : scope.kind === "content" ? "content" : "shared";
  const remoteHash = scope.kind === "page" ? index.pages.find(p => p.id === id)?.hash || await fingerprint(null) : scope.kind === "part" ? index.parts[scope.part] : scope.kind === "theme" ? index.themeHash || await fingerprint(scopedSource(draft.source, scope)) : scope.kind === "content" ? index.contentHash || await fingerprint(scopedSource(draft.source, scope)) : index.sharedHash;
  const localValue = scopedSource(draft.config, scope), baseline = scopedSource(draft.source, scope);
  if (scope.kind === "page" && !(draft.downloaded || draft.source?.pages.map(p => p.id) || []).includes(id) && !pageValue(draft.config, id) && index.pages.some(p => p.id === id)) return "unfetched";
  const [localHash, baseHash] = await Promise.all([fingerprint(localValue), fingerprint(baseline)]);
  if (localHash === remoteHash) return "synced";
  const changedHere = localHash !== baseHash, changedThere = remoteHash !== baseHash;
  return changedHere && changedThere ? "conflict" : changedThere ? "remote" : "local";
}

/** Refresh untouched shared scopes on entry, retaining unpublished edits and page caches. */
export function refreshUneditedScopes(draft: LocalDraft, remote: ShopConfig, base: number): LocalDraft {
  if (!draft.source || draft.pending) return draft;
  let config = draft.config, source = draft.source;
  for (const scope of [{ kind: "content" }, { kind: "theme" }, { kind: "part", part: "header" }, { kind: "part", part: "footer" }] as const) {
    const local = scopedSource(config, scope), baseline = scopedSource(source, scope), published = scopedSource(remote, scope);
    if ((!same(local, baseline) && !same(local, published)) || (same(local, published) && same(baseline, published))) continue;
    config = replaceScope(config, scope, published);
    source = replaceScope(source, scope, published);
  }
  return config === draft.config && source === draft.source && base === draft.base ? draft : { ...draft, config, source, base };
}

import { shopSchema, type ShopConfig } from "../server/domain";
import { pageSchema } from "../server/pages";
export function replaceScope(config: ShopConfig, scope: ReleaseScope, value: unknown): ShopConfig {
  if (scope.kind === "theme") return shopSchema.parse(replaceTheme(config, value));
  if (scope.kind === "content") return shopSchema.parse(replaceContent(config, value));
  if (scope.kind === "shared") return shopSchema.parse(replaceShared(config, value));
  if (scope.kind === "part") return shopSchema.parse(replacePart(config, scope.part, value));
  const page = value === null ? null : pageSchema.parse(value);
  if (page && page.id !== scope.pageId) throw new Error(tr("ページIDが一致しません"));
  const exists = config.pages.some(p => p.id === scope.pageId);
  const pages = page ? (exists ? config.pages.map(p => p.id === scope.pageId ? page : p) : [...config.pages, page]) : config.pages.filter(p => p.id !== scope.pageId);
  return shopSchema.parse({ ...config, pages });
}
