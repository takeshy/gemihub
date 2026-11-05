import { createHash } from "node:crypto";
import { scopedSource, pageSchema } from "./pages.ts";
import type { ShopConfig } from "./domain.ts";
import type { EditorIndex } from "./editor-index-schema.ts";
import { stableJson } from "../shared/stable-json.ts";
export const contentHash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
export function editorIndex(config: ShopConfig | null, base: number, lastPublishedPlanId?: string): EditorIndex {
  return { base, published: !!config, lastPublishedPlanId, sharedHash: contentHash(scopedSource(config, { kind: "shared" })), parts: { header: contentHash(scopedSource(config, { kind: "part", part: "header" })), footer: contentHash(scopedSource(config, { kind: "part", part: "footer" })) }, pages: (config?.pages || []).map(p => ({ id: p.id, title: p.title, slug: p.slug, hash: contentHash(pageSchema.parse(p)) })) };
}
