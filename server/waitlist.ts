import { createHash } from "node:crypto";
import { z } from "zod";
import { origin } from "./auth.ts";
import { bookingHeldSince, bookingStaffName, menuSelection, type Booking, type ShopConfig } from "./domain.ts";
import { requestLocale } from "./i18n.ts";
import { judgeActive } from "./judge.ts";
import { isArchivedShop, type Shop, type Store } from "./store.ts";
import { customerPaneUrl } from "./storefront-build.tsx";
import { getLocale, intlLocale, tr } from "../shared/i18n.ts";
import { formatMinor, regionOf, zonedDate, type Currency } from "../shared/region.ts";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const slotWishInputSchema = z.object({
  date: z.iso.date(), from: time, to: time,
  menuId: z.string().min(1).max(200), optionIds: z.array(z.string().max(200)).max(20).default([]).transform(ids => ids.sort()),
  staffId: z.string().max(200).optional(), discountOnly: z.boolean().default(false),
}).refine(wish => wish.from < wish.to, { error: () => tr("開始より後の終了時刻を選んでください") });
export type SlotWish = z.infer<typeof slotWishInputSchema> & {
  id: string; shopId: string; customer: string; name: string; locale: "ja" | "en"; createdAt: string;
  /** Openings captured at registration. Legacy wishes without a baseline initialize on their first check. */
  seen?: string[];
  /** When the last ordinary-slot notice went out. */
  notifiedAt?: number;
};
export const maxWishesPerCustomer = 10;
/** Slots flap as payment holds lapse, so ordinary-slot notices wait this long; a new discounted listing is never held back. */
export const slotNoticeCooldownMs = 60 * 60_000;
const mailedSlotTimes = 5;

export type WaitlistSlot = { start: string; end: string };
export type WaitlistListing = WaitlistSlot & {
  id: string; bookingId: string; seller: string; menuId: string; staffId: string; menu: string;
  price: number; currency: Currency; discountPercent: number; deadline: string;
  /** Another customer is paying, so nobody else can take it right now. */
  busy: boolean;
};

const bounds = (config: ShopConfig, wish: SlotWish) => {
  const timeZone = regionOf(config).timeZone;
  return { from: zonedDate(wish.date, wish.from, timeZone).getTime(), to: zonedDate(wish.date, wish.to, timeZone).getTime() };
};
const within = (range: ReturnType<typeof bounds>, slot: WaitlistSlot) => Date.parse(slot.start) >= range.from && Date.parse(slot.end) <= range.to;
const listingKey = (id: string) => `listing:${id}`;
const slotKey = (start: string) => `slot:${start}`;

/** A wish still worth keeping for this customer in the booking window. */
export function wishError(config: ShopConfig, wish: Pick<SlotWish, "date" | "menuId" | "optionIds" | "staffId">, dates: string[]) {
  if (!dates.length || wish.date < dates[0] || wish.date > dates.at(-1)!) return tr("予約を受け付けている期間の日付を選んでください");
  const selection = menuSelection(config, wish.menuId, wish.optionIds);
  if (!selection) return tr("メニューと追加メニューの組み合わせを確認してください");
  return undefined;
}

const watched = (shop: Shop) => !!shop.published && !isArchivedShop(shop) && (!!shop.google || !!shop.judge) && (!shop.judge || judgeActive());
const wishKey = (wish: SlotWish) => JSON.stringify([wish.date, wish.menuId, [...wish.optionIds].sort(), wish.staffId]);

const fittingListings = (wish: SlotWish, range: ReturnType<typeof bounds>, listings: WaitlistListing[]) =>
  listings.filter(listing => listing.seller !== wish.customer && listing.menuId === wish.menuId &&
    (!wish.staffId || listing.staffId === wish.staffId) && within(range, listing));
const matchingSlots = (wish: SlotWish, range: ReturnType<typeof bounds>, slots: WaitlistSlot[], now: number) =>
  wish.discountOnly ? [] : slots.filter(slot => within(range, slot) && Date.parse(slot.start) > now);
const openingKeys = (listings: WaitlistListing[], slots: WaitlistSlot[]) =>
  [...listings.map(listing => listingKey(listing.id)), ...slots.map(slot => slotKey(slot.start))];

/** Capture before saving the wish, so openings appearing before the first worker run are new. */
export function waitlistBaseline(config: ShopConfig, wish: SlotWish, slots: WaitlistSlot[], listings: WaitlistListing[], now = Date.now()) {
  const range = bounds(config, wish);
  return openingKeys(fittingListings(wish, range, listings).filter(listing => !listing.busy), matchingSlots(wish, range, slots, now));
}

/**
 * Reads ordinary openings for every wish. Calendar is slower than others wait for the mail
 * lock, so this runs before taking it. A notice says slots are first come, first served.
 * A wish missing from the result is left for the next check.
 */
export async function readWaitlistOpenings(store: Store, shop: Shop, slots: (wish: SlotWish) => Promise<WaitlistSlot[]>) {
  const openings = new Map<string, WaitlistSlot[]>();
  if (!watched(shop)) return openings;
  const read = new Set<string>();
  for (const wish of await store.records<SlotWish>("slotWish", shop)) {
    const key = wishKey(wish);
    if (wish.discountOnly || read.has(key)) continue;
    read.add(key);
    // An unreadable calendar is not an opening.
    try { openings.set(key, await slots(wish)); }
    catch (error) { console.error(error); }
  }
  return openings;
}

/** Caller holds the shop's mail lock. Each notice commits together with what the wish has seen. */
export async function queueWaitlistNotices(store: Store, shop: Shop, source: {
  openings: Map<string, WaitlistSlot[]>;
  listings: () => Promise<WaitlistListing[]>;
  enqueue: (id: string, mail: { to: string; cc: string[]; subject: string; body: string; wishId?: string }) => Promise<void>;
}, now = Date.now()) {
  if (!watched(shop)) return;
  const wishes = await store.records<SlotWish>("slotWish", shop);
  if (!wishes.length) return;
  const config = shop.published!;
  const [bookings, listings] = await Promise.all([store.bookings(shop.id), source.listings()]);
  for (const wish of wishes) {
    const range = bounds(config, wish);
    if (range.to <= now || bookings.some(booking => booked(booking, wish, range, listings))) {
      await store.delete("slotWish", wish.id);
      continue;
    }
    const selection = menuSelection(config, wish.menuId, wish.optionIds);
    if (!selection) {
      // Deletes do not join a transaction, so the wish goes only after its keyed notice is safely queued.
      await requestLocale.run(wish.locale || shop.locale || "ja", () => source.enqueue(`waitlist-ended:${wish.id}`, { to: wish.customer, cc: [], ...ended(shop, config, wish) }));
      await store.delete("slotWish", wish.id);
      continue;
    }
    const fitting = fittingListings(wish, range, listings);
    const matching = fitting.filter(listing => !listing.busy);
    let slots: WaitlistSlot[] = [];
    if (!wish.discountOnly) {
      const open = source.openings.get(wishKey(wish));
      if (!open) continue;
      slots = matchingSlots(wish, range, open, now);
    }
    const current = openingKeys(matching, slots);
    if (!wish.seen) { await store.put("slotWish", wish.id, { ...wish, seen: current }); continue; }
    const seen = new Set(wish.seen);
    const newListings = matching.filter(listing => !seen.has(listingKey(listing.id)));
    const newSlots = slots.filter(slot => !seen.has(slotKey(slot.start)));
    const sendSlots = newSlots.length > 0 && now - (wish.notifiedAt || 0) >= slotNoticeCooldownMs;
    // A slot held back by the cooldown stays unseen, so it goes out once the cooldown ends if still open.
    // A listing someone is paying for stays seen: if their payment lapses, it is the same listing, not a new one.
    const paying = fitting.filter(listing => listing.busy).map(listing => listingKey(listing.id)).filter(key => seen.has(key));
    const nextSeen = [...current.filter(key => key.startsWith("listing:") || seen.has(key) || sendSlots), ...paying];
    const next: SlotWish = { ...wish, seen: nextSeen, ...(sendSlots ? { notifiedAt: now } : {}) };
    if (!newListings.length && !sendSlots) {
      if (nextSeen.length !== wish.seen.length || nextSeen.some(key => !seen.has(key))) await store.put("slotWish", wish.id, next);
      continue;
    }
    const sent = [...newListings.map(listing => listing.id), ...(sendSlots ? newSlots.map(slot => slot.start) : [])];
    const id = `waitlist:${createHash("sha256").update(JSON.stringify([wish.id, now, sent])).digest("hex")}`;
    await requestLocale.run(wish.locale || shop.locale || "ja", async () => {
      const mail = notice(shop, config, wish, selection.base.name, newListings, sendSlots ? newSlots : []);
      await store.transaction(async () => {
        await source.enqueue(id, { to: wish.customer, cc: [], ...mail, wishId: wish.id });
        await store.put("slotWish", wish.id, next);
      });
    });
  }
}

/** The customer took a time in this wish, so it is done. A booking held since before the wish, or awaiting a replacement, does not count: they may be asking to move it. */
function booked(booking: Booking, wish: SlotWish, range: ReturnType<typeof bounds>, listings: WaitlistListing[]) {
  return booking.status === "active" && booking.customer === wish.customer && within(range, booking) &&
    Date.parse(bookingHeldSince(booking)) >= Date.parse(wish.createdAt) && !listings.some(listing => listing.bookingId === booking.id);
}

/** The shop stopped offering the wished menu, so no opening can ever match: say so rather than go quiet. */
function ended(shop: Shop, config: ShopConfig, wish: SlotWish) {
  return {
    subject: tr("{0} 空き通知を停止しました", config.name),
    body: tr("{0} 様\nご希望のメニューの受付が終了したため、次の空き通知を停止しました。\nご希望: {1} {2}〜{3}\n\nほかのメニューのご予約: {4}", wish.name, wish.date.replaceAll("-", "/"), wish.from, wish.to, customerPaneUrl(shop, origin(), "reserve", getLocale())),
  };
}

function notice(shop: Shop, config: ShopConfig, wish: SlotWish, menu: string, listings: WaitlistListing[], slots: WaitlistSlot[]) {
  const timeZone = regionOf(config).timeZone;
  const dateTime = (at: string) => new Date(at).toLocaleString(intlLocale(), { timeZone, timeZoneName: "short" });
  const clock = (at: string) => new Date(at).toLocaleTimeString(intlLocale(), { timeZone, hour: "2-digit", minute: "2-digit" });
  const link = (pane: string) => customerPaneUrl(shop, origin(), pane, getLocale());
  const shown = slots.slice(0, mailedSlotTimes).map(slot => clock(slot.start)).join(", ");
  const rest = slots.length - mailedSlotTimes;
  const lines = [
    ...listings.map(listing => tr("お得な空き枠: {0}\n{1} / {2}\n{3}（{4}%引き）・受付期限 {5}", dateTime(listing.start), listing.menu, bookingStaffName(config, listing.staffId), formatMinor(listing.price, listing.currency, intlLocale()), listing.discountPercent, dateTime(listing.deadline))),
    ...(slots.length ? [tr("空いている時間: {0}", rest > 0 ? tr("{0} ほか{1}件", shown, rest) : shown)] : []),
  ];
  return {
    subject: listings.length ? tr("{0} ご希望の日時にお得な空き枠が出ました", config.name) : tr("{0} ご希望の日時に空きが出ました", config.name),
    body: tr("{0} 様\nご希望の条件に合う空きが出ました。\nご希望: {1} {2}〜{3}\nメニュー: {4}\n\n{5}\n\n先着順です。枠は確保されていないため、すでに埋まっている場合があります。\nご予約: {6}\n\nこの通知を止める: {7}", wish.name, wish.date.replaceAll("-", "/"), wish.from, wish.to, menu, lines.join("\n\n"), link("reserve"), link("mine")),
  };
}
