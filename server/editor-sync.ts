import { createHash } from "node:crypto";
import { scopedSource, pageSchema } from "./pages.ts";
import type { ShopConfig } from "./domain.ts";
import type { EditorIndex } from "./editor-index-schema.ts";
export const contentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function editorIndex(config: ShopConfig | null, base: number, lastPublishedPlanId?: string): EditorIndex {
  return { base, published: !!config, lastPublishedPlanId, sharedHash: contentHash(scopedSource(config, { kind: "shared" })), parts: { header: contentHash(config?.header || null), footer: contentHash(config?.footer || null) }, pages: (config?.pages || []).map(p => ({ id: p.id, title: p.title, slug: p.slug, hash: contentHash(pageSchema.parse(p)) })) };
}
