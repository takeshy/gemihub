import {postImageIds} from "../server/post-images";
import { customerProfileSchema, type MemberProfile } from "../server/customer-profile";
import { z } from "zod";
import { shopSchema, slots, dateJST, type ShopConfig } from "../server/domain";
import { editorIndexSchema } from "../server/editor-index-schema";
import { releaseScopeSchema } from "../server/pages";
import { managedImageIds } from "../server/image-references";
import { postContentSchema, postKey, type PublicPost } from "../server/post-domain";
import type { ApiClient } from "./api";

const bookingSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), menuId: z.string(), staffId: z.string(),
  start: z.iso.datetime(), end: z.iso.datetime(), status: z.enum(["active", "cancelled", "no_show"]),
}).refine(b => Date.parse(b.start) < Date.parse(b.end), "予約の終了は開始より後にしてください");
export const fixturesSchema = z.object({
  customerName: z.string().min(1).max(100),
  bookings: z.array(bookingSchema).max(100),
  posts: z.array(postContentSchema).max(50),
});
export type Fixtures = z.infer<typeof fixturesSchema>;
export function sampleFixtures(config: ShopConfig): Fixtures {
  const date = dateJST(new Date(Date.now() + 3 * 86400000));
  const first = config.staff[0];
  const menu = config.menus.find(m => first.menuIds.includes(m.id))!;
  const start = new Date(`${date}T${first.start}:00+09:00`);
  return {
    customerName: "山田 花子（サンプル）",
    bookings: [{ id: "sample-booking", name: "山田 花子（サンプル）", menuId: menu.id, staffId: first.id, start: start.toISOString(), end: new Date(start.getTime() + menu.duration * 60000).toISOString(), status: "active" }],
    posts: ["blogs", "announcements"].map((category, i) => ({
      category: category as "blogs" | "announcements", date: dateJST(), slug: `sample-${i}`,
      title: i ? "営業日のご案内（サンプル）" : "お店からのお便り（サンプル）",
      excerpt: "表示を確かめるためのサンプルです。", body: "## お店からのご案内\n\nここに記事のサンプル本文が入ります。",
    })),
  };
}
export const localDraftSchema = z.object({
  backups: z.array(z.object({ at: z.string(), scope: releaseScopeSchema, baseline: z.unknown(), localValue: z.unknown(), remoteValue: z.unknown() })).max(20).optional(),
  downloaded: z.array(z.string()).optional(), index: editorIndexSchema.optional(),
  config: shopSchema, source: shopSchema.nullable(), base: z.number().int(), fixtures: fixturesSchema,
  pending: z.object({ requestId: z.uuid(), config: shopSchema, scope: releaseScopeSchema.optional(), planId: z.string().optional() }).optional(),
});
export type LocalDraft = z.infer<typeof localDraftSchema>;
// Separate by signed-in account and shop. No tokens or real customer records.
export const draftKey = (email: string, shopId: string) => `omaiweb:local-preview:${email}:${shopId}`;
export function readDraft(storage: Pick<Storage, "getItem">, key: string) {
  const raw = storage.getItem(key);
  return raw ? localDraftSchema.parse(JSON.parse(raw)) : undefined;
}
export function writeDraft(storage: Pick<Storage, "setItem">, key: string, draft: z.input<typeof localDraftSchema>) {
  storage.setItem(key, JSON.stringify(localDraftSchema.parse(draft)));
}
export function createPreviewClient(config: ShopConfig, fixtures: Fixtures, shopId: string, readImage?: (imageId: string) => Promise<import("../server/menu-image-domain").MenuImageData>): ApiClient {
  const bookings = fixtures.bookings.map(b => ({ ...b, shopId, price: config.menus.find(menu => menu.id === b.menuId)?.price ?? 0, message: "", customer: "sample@example.com", createdAt: new Date().toISOString() }));
  const posts: PublicPost[] = fixtures.posts.map((p, i) => ({ ...p, id: `sample-${i}`, publishedAt: `${p.date}T00:00:00Z` }));
  const base = "/api/public/local-preview";
  let profile: MemberProfile = { name: fixtures.customerName, birthDate: "1990-01-01", gender: "not_specified" };
  return async <T>(path: string, data?: unknown): Promise<T> => {
    const url = new URL(path, "https://preview.invalid");
    const action = url.pathname;
    const input = (data || {}) as Record<string, string>;
    let result: unknown;
    const image = action.match(/^\/api\/public\/local-preview\/(menu-images|images)\/([a-f0-9]{64})$/);
    if (image) {
      const ids = image[1] === "images" ? [...managedImageIds(config),...posts.flatMap(post=>postImageIds(post.body))] : config.menus.filter(menu => menu.active).map(menu => menu.imageId);
      if (!ids.includes(image[2]) || !readImage) throw new Error("画像がありません");
      result = await readImage(image[2]);
    }
    else if (action === base) result = { config, shopId, recentPosts: posts.slice(0, 5), customerProfile: profile, registrationRequired: false };
    else if (action === `${base}/slots`) result = slots(config, bookings, url.searchParams.get("date") || "", url.searchParams.get("menu") || "", url.searchParams.get("staff") || undefined);
    else if (action === `${base}/bookings` && data === undefined) result = bookings;
    else if (action === `${base}/bookings`) {
      const slot = slots(config, bookings, dateJST(new Date(input.start)), input.menuId, input.staffId || undefined).find(s => s.start === input.start);
      if (!slot) throw new Error("この時間は予約できません。空き枠を選び直してください。");
      bookings.push({ ...slot, id: `practice-${bookings.length}`, name: input.name, message: input.message || "", menuId: input.menuId, price: config.menus.find(menu => menu.id === input.menuId)!.price, status: "active", shopId, customer: "sample@example.com", createdAt: new Date().toISOString() });
      result = { ok: true };
    } else if (action.startsWith(`${base}/bookings/`) && action.endsWith("/cancel")) {
      const b = bookings.find(b => b.id === action.split("/").at(-2));
      if (!b) throw new Error("サンプル予約がありません");
      b.status = "cancelled";
      result = { ok: true };
    } else if (action === `${base}/profile`) { if (data !== undefined) profile = customerProfileSchema.parse(data); result = {profile};
    } else if (action === `${base}/inquiries`) result = { ok: true };
    else if (action === `${base}/posts`) {
      const all = posts.filter(p => !url.searchParams.get("category") || p.category === url.searchParams.get("category"));
      const page = Number(url.searchParams.get("page") || 1);
      result = { items: all.slice((page - 1) * 12, page * 12), total: all.length, page, size: 12 };
    } else {
      const match = action.match(/^\/api\/public\/local-preview\/posts\/(blogs|announcements)\/([^/]+)$/);
      if (!match) throw new Error("この操作は試す画面では利用できません");
      result = posts.find(p => p.category === match[1] && postKey(p) === match[2]);
      if (!result) throw new Error("サンプル記事がありません");
    }
    return structuredClone(result) as T;
  };
}
