import type { SlotWish } from "./Waitlist";
import { tr } from "../shared/i18n";
import { articleKinds } from "../shared/article-features";
import { dateIn, regionOf, zonedDate } from "../shared/region";
import { simulatePayment, simulateCancellation } from "./payment-mock";
import { defaultRefundTiers, refundQuote } from "../server/payment-domain";
import type { Booking } from "../server/domain";
import {postImageIds} from "../server/post-images";
import { customerProfileSchema, type MemberProfile } from "../server/customer-profile";
import { z } from "zod";
import { shopSchema, slots, firstAvailableSlots, bookingStaff, menuSelection, type ShopConfig } from "../server/domain";
import { editorIndexSchema } from "../server/editor-index-schema";
import { releaseScopeSchema } from "../server/pages";
import { managedImageIds } from "../server/image-references";
import { postContentSchema, postKey, type PublicPost } from "../server/post-domain";
import type { ApiClient } from "./api";

const bookingSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), menuId: z.string(), staffId: z.string(),
  optionIds: z.array(z.string()).max(10).optional(),
  start: z.iso.datetime(), end: z.iso.datetime(), status: z.enum(["active", "cancelled", "no_show"]),
  paymentStatus: z.enum(["automatic", "unpaid", "paid", "refunded"]).optional(),
  refundPercent: z.number().int().min(1).max(100).optional(),
}).refine(b => Date.parse(b.start) < Date.parse(b.end), { error: () => tr("予約の終了は開始より後にしてください") })
  .refine(b => b.paymentStatus !== "refunded" || b.status === "cancelled", { error: () => tr("返金済みのサンプル予約はキャンセル済みにしてください") });
export const fixturesSchema = z.object({
  customerName: z.string().min(1).max(100),
  bookings: z.array(bookingSchema).max(100),
  posts: z.array(postContentSchema).max(50),
});
export type Fixtures = z.infer<typeof fixturesSchema>;
export function sampleFixtures(config: ShopConfig): Fixtures {
  const timeZone = regionOf(config).timeZone;
  const date = dateIn(Date.now() + 3 * 86400000, timeZone);
  const booking = (paid = false): Fixtures["bookings"][number] | undefined => {
    const staff = bookingStaff(config).find(staff => config.menus.some(menu => menu.active && !menu.optionFor && (!paid || menu.price > 0) && staff.menuIds.includes(menu.id)));
    const menu = config.menus.find(menu => menu.active && !menu.optionFor && (!paid || menu.price > 0) && staff?.menuIds.includes(menu.id));
    if (!staff || !menu) return undefined;
    const start = zonedDate(date, staff.start, timeZone);
    return { id: paid ? "sample-refunded-booking" : "sample-booking", name: tr("山田 花子（サンプル）"), menuId: menu.id, staffId: staff.id, start: start.toISOString(), end: new Date(start.getTime() + menu.duration * 60000).toISOString(), status: paid ? "cancelled" : "active", ...(paid ? { paymentStatus: "refunded", refundPercent: 100 } : {}) };
  };
  return {
    customerName: tr("山田 花子（サンプル）"),
    bookings: [booking(), booking(true)].filter((booking): booking is Fixtures["bookings"][number] => !!booking),
    posts: articleKinds(config).map((category, i) => ({
      category: category as "blogs" | "announcements", date: dateIn(Date.now(), timeZone), slug: `sample-${i}`,
      title: category === "announcements" ? tr("営業日のご案内（サンプル）") : tr("お店からのお便り（サンプル）"),
      excerpt: tr("表示を確かめるためのサンプルです。"), body: tr("## お店からのご案内\n\nここに記事のサンプル本文が入ります。"),
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
// Features are chosen for the live shop; cached screen designs must not re-enable removed features.
export function syncPreviewArticleFeatures(draft: LocalDraft, current: ShopConfig): LocalDraft {
  const articles = current.appearance?.articles;
  if (JSON.stringify(draft.config.appearance?.articles) === JSON.stringify(articles) && (!draft.source || JSON.stringify(draft.source.appearance?.articles) === JSON.stringify(articles))) return draft;
  const update = (config: ShopConfig): ShopConfig => ({ ...config, appearance: config.appearance || articles ? { accent: "sage", layout: "standard", imageUrl: "", ...config.appearance, articles } : undefined });
  return { ...draft, index: undefined, config: update(draft.config), source: draft.source && update(draft.source) };
}
// Separate by signed-in account and shop. No tokens or real customer records.
export const draftKey = (email: string, shopId: string) => `gemihub:local-preview:${email}:${shopId}`;
export function readDraft(storage: Pick<Storage, "getItem">, key: string) {
  const raw = storage.getItem(key);
  return raw ? localDraftSchema.parse(JSON.parse(raw)) : undefined;
}
export function writeDraft(storage: Pick<Storage, "setItem">, key: string, draft: z.input<typeof localDraftSchema>) {
  storage.setItem(key, JSON.stringify(localDraftSchema.parse(draft)));
}
export function createPreviewClient(config: ShopConfig, fixtures: Fixtures, shopId: string, readImage?: (imageId: string, view?: "display" | "thumbnail") => Promise<import("../server/menu-image-domain").MenuImageData>, customerEmail = "sample@example.com"): ApiClient {
  const bookings: Booking[] = fixtures.bookings.map(({ paymentStatus, refundPercent, ...fixture }) => {
    const selected = menuSelection(config, fixture.menuId, fixture.optionIds);
    const booking: Booking = { ...fixture, ...(selected?.optionIds.length ? { optionIds: selected.optionIds, items: selected.items } : {}), shopId, price: selected?.price ?? 0, message: "", customer: customerEmail, createdAt: new Date().toISOString() };
    if (paymentStatus === "unpaid") return booking;
    const paid = paymentStatus === "paid" || paymentStatus === "refunded";
    simulatePayment(booking, paid ? { ...config, rules: { ...config.rules, payment: { enabled: true, refundTiers: config.rules.payment?.refundTiers || defaultRefundTiers } } } : config);
    if (paymentStatus === "refunded" && booking.payment) {
      const percent = refundPercent ?? 100;
      booking.status = "cancelled";
      booking.payment.cancellation = { at: new Date().toISOString(), by: customerEmail, reason: "customer", percent, amount: Math.floor(booking.payment.amount * percent / 100), status: "completed", requestId: `sample-refund-${booking.id}`, refundId: `sample-refund-${booking.id}` };
    }
    return booking;
  });
  const posts: PublicPost[] = fixtures.posts.filter(post => articleKinds(config).includes(post.category)).map((p, i) => ({ ...p, id: `sample-${i}`, publishedAt: `${p.date}T00:00:00Z` }));
  const base = "/api/public/local-preview";
  let wishes: SlotWish[] = [];
  let profile: MemberProfile = { name: fixtures.customerName, birthDate: "1990-01-01", gender: "not_specified" };
  return async <T>(path: string, data?: unknown): Promise<T> => {
    const url = new URL(path, "https://preview.invalid");
    const action = url.pathname;
    const input = (data || {}) as Record<string, string>;
    let result: unknown;
    const image = action.match(/^\/api\/public\/local-preview\/(menu-images|images)\/([a-f0-9]{64})$/);
    if (image) {
      const ids = image[1] === "images" ? [...managedImageIds(config),...posts.flatMap(post=>postImageIds(post.body))] : config.menus.filter(menu => menu.active).map(menu => menu.imageId);
      if (!ids.includes(image[2]) || !readImage) throw new Error(tr("画像がありません"));
      const view = url.searchParams.get("view");
      result = await readImage(image[2], view === "display" || view === "thumbnail" ? view : undefined);
    }
    else if (action === base) result = { config, shopId, recentPosts: posts.slice(0, 5), paymentSimulation: true, customerProfile: profile, registrationRequired: false };
    else if (action === `${base}/slots/next`) result = firstAvailableSlots(config, bookings, url.searchParams.get("menu") || "", url.searchParams.get("staff") || undefined, url.searchParams.getAll("option"));
    else if (action === `${base}/slots`) result = slots(config, bookings, url.searchParams.get("date") || "", url.searchParams.get("menu") || "", url.searchParams.get("staff") || undefined,undefined,url.searchParams.getAll("option"));
    else if (action === `${base}/checkouts`) result = [];
    // Transfers need a second customer and real payments, so the offline preview shows none.
    else if (action === `${base}/transfers`) result = [];
    else if (action === `${base}/transfers/mine`) result = { selling: [], buying: [] };
    else if (action === `${base}/coupons`) result = [];
    else if (action === `${base}/waitlist` && data === undefined) result = wishes;
    else if (action === `${base}/waitlist`) { wishes.push({ ...(data as Omit<SlotWish, "id">), id: `practice-${wishes.length}-${Date.now()}` }); result = { ok: true }; }
    else if (action.startsWith(`${base}/waitlist/`)) { wishes = wishes.filter(wish => wish.id !== action.split("/").at(-2)); result = { ok: true }; }
    else if (action.startsWith(`${base}/bookings/`) && action.endsWith("/transfer-quote")) result = { eligible: false, reason: tr("譲渡は公開中の予約ページで利用できます。") };
    else if (action === `${base}/bookings` && data === undefined) result = bookings;
    else if (action === `${base}/bookings`) {
      const optionIds = (data as {optionIds?:string[]}).optionIds || [];
      const selected = menuSelection(config,input.menuId,optionIds);
      if(!selected)throw new Error(tr("メニューと追加メニューの組み合わせを確認してください"));
      const slot = slots(config, bookings, dateIn(input.start, regionOf(config).timeZone), input.menuId, input.staffId || undefined,undefined,optionIds).find(s => s.start === input.start);
      if (!slot) throw new Error(tr("この時間は予約できません。空き枠を選び直してください。"));
      const booking=simulatePayment({ ...slot, ...(selected.optionIds.length?{optionIds:selected.optionIds,items:selected.items}:{}), id: `practice-${bookings.length}`, name: input.name, message: input.message || "", menuId: input.menuId, price: selected.price, status: "active", shopId, customer: customerEmail, createdAt: new Date().toISOString() }, config);
      bookings.push(booking); result = { ok: true, booking };
    } else if (action.startsWith(`${base}/bookings/`) && action.endsWith("/cancel-quote")) {
      const b = bookings.find(b => b.id === action.split("/").at(-2));
      if (!b?.payment) throw new Error(tr("支払い済みのサンプル予約がありません"));
      result = refundQuote(b.payment.amount, b.start, new Date().toISOString(), b.payment.policy, "customer");
    } else if (action.startsWith(`${base}/bookings/`) && action.endsWith("/cancel")) {
      const b = bookings.find(b => b.id === action.split("/").at(-2));
      if (!b) throw new Error(tr("サンプル予約がありません"));
      simulateCancellation(b, "customer");
      result = { ok: true };
    } else if (action === `${base}/profile`) { if (data !== undefined) profile = customerProfileSchema.parse(data); result = {profile};
    } else if (action === `${base}/inquiries`) result = { ok: true };
    else if (action === `${base}/posts`) {
      const all = posts.filter(p => !url.searchParams.get("category") || p.category === url.searchParams.get("category"));
      const page = Number(url.searchParams.get("page") || 1);
      result = { items: all.slice((page - 1) * 12, page * 12), total: all.length, page, size: 12 };
    } else {
      const match = action.match(/^\/api\/public\/local-preview\/posts\/(blogs|announcements)\/([^/]+)$/);
      if (!match) throw new Error(tr("この操作は試す画面では利用できません"));
      result = posts.find(p => p.category === match[1] && postKey(p) === match[2]);
      if (!result) throw new Error(tr("サンプル記事がありません"));
    }
    return structuredClone(result) as T;
  };
}
