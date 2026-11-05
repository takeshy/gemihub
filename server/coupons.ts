import { tr } from "../shared/i18n.ts";
import { currencyOf, dateIn, regionOf, toMinor, fromMinor, validPrice, zonedDate } from "../shared/region.ts";
import { couponDiscount, couponRuleIssues, manualCouponSchema, type CouponCampaign, type CouponGrant, type CouponRule, type CouponWalletItem, type BookingCoupon } from "../shared/coupons.ts";
import { isArchivedShop, type Shop, type Store } from "./store.ts";
import { memberProfile } from "./customer-profile.ts";
import { digest } from "./auth.ts";
import { isVisit, normalizeEmail } from "./customers.ts";
import { checkoutHolding, type Checkout } from "./payments.ts";
import type { Booking } from "./domain.ts";
// Owners record no-shows after the appointment; give them a day before a visit counts.
export const visitSettleMs = 86400000;
// Each run stays short enough not to starve bookings waiting on the lock; the next minute continues.
export const issueLimit = 100;
const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 409 }); };
export function validateCouponRule(rule: CouponRule, shop: Shop) {
  if (!shop.published) fail(tr("先にお店を公開してください"));
  const issues = couponRuleIssues(rule);
  if (issues.length) fail(issues[0].message);
  if (rule.discount.type === "amount" && !validPrice(rule.discount.value, currencyOf(regionOf(shop.published)))) fail(tr("割引金額の通貨単位を確認してください"));
}
function matches(rule: CouponRule, visits: number, ended: number, birthDate: string | undefined, date: string) {
  const values = rule.conditions.map(c => c.type === "everyone" ? true : c.type === "first_visit" ? ended === 0 : c.type === "birthday_month" ? !!birthDate && birthDate.slice(5, 7) === date.slice(5, 7) : c.comparison === "exact" ? visits === c.count : c.comparison === "multiple" ? visits > 0 && visits % c.count === 0 : visits >= c.count);
  return rule.match === "all" ? values.every(Boolean) : values.some(Boolean);
}
// A daylight-saving gap runs at the next valid local minute, rather than midnight.
function scheduledAt(date: string, hour: number, zone: string) {
  for (let minute = hour * 60; minute < 1440; minute++) {
    const at = zonedDate(date, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, zone).getTime();
    if (Number.isFinite(at)) return at;
  }
  return Infinity;
}
const activeCampaigns = async (store: Store, shop: Shop) => !shop.published || isArchivedShop(shop) ? [] : (await store.records<CouponCampaign>("couponCampaign", shop)).filter(c => c.enabled && c.currency === currencyOf(regionOf(shop.published)));
/** Lets the scheduler skip the booking lock for shops with nothing to distribute. */
export const hasActiveCoupons = async (store: Store, shop: Shop) => (await activeCampaigns(store, shop)).length > 0;
function dueAt(campaign: CouponCampaign, today: string, zone: string, now: number) {
  const s = campaign.schedule;
  if (s.type === "once") return scheduledAt(s.date, s.hour, zone);
  if (s.type !== "monthly") return now;
  const [year, month] = today.split("-").map(Number), day = Math.min(s.day, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return scheduledAt(`${today.slice(0, 7)}-${String(day).padStart(2, "0")}`, s.hour, zone);
}
const pausedAt = (campaign: CouponCampaign, at: number) => !!campaign.pausedRanges?.some(range => Date.parse(range.from) <= at && at < Date.parse(range.to));
/** A resumed campaign remembers its pause, so visits and dates inside it are never distributed late. */
export function campaignEnabled(campaign: CouponCampaign, enabled: boolean, at: string): CouponCampaign {
  if (campaign.enabled === enabled) return campaign;
  if (!enabled) return { ...campaign, enabled, pausedAt: at, updatedAt: at };
  const { pausedAt: from, ...rest } = campaign;
  return { ...rest, enabled, pausedRanges: [...(campaign.pausedRanges || []), { from: from || campaign.updatedAt, to: at }], updatedAt: at };
}
/** Caller holds bookingLockKey. Business records, rather than AI, determine eligibility. */
export async function issueCoupons(store: Store, shop: Shop, now = Date.now()) {
  const campaigns = await activeCampaigns(store, shop);
  if (!campaigns.length) return;
  const zone = regionOf(shop.published).timeZone, today = dateIn(new Date(now), zone);
  const due = campaigns.map(campaign => ({ campaign, at: dueAt(campaign, today, zone, now) })).filter(({ campaign, at }) => now >= at && !pausedAt(campaign, at) && !(campaign.schedule.type === "monthly" && at < Date.parse(campaign.createdAt)));
  if (!due.length) return;
  const [bookings, customers, grants] = await Promise.all([store.bookings(shop.id), store.records<{ email: string; birthDate?: string; createdAt?: string }>("customer", shop), store.records<CouponGrant>("couponGrant", shop)]);
  const members = customers.filter(record => memberProfile(record)), granted = new Set(grants.map(grant => grant.id)), endedVisits = new Map<string, Booking[]>();
  for (const booking of bookings) if (isVisit(booking, new Date(now))) {
    const email = normalizeEmail(booking.customer);
    endedVisits.set(email, [...(endedVisits.get(email) || []), booking]);
  }
  for (const visits of endedVisits.values()) visits.sort((a, b) => Date.parse(a.end) - Date.parse(b.end) || a.id.localeCompare(b.id));
  let remaining = issueLimit;
  for (const { campaign, at } of due) {
    const s = campaign.schedule;
    for (const record of members) {
      if ((s.type === "once" || s.type === "monthly") && record.createdAt && Date.parse(record.createdAt) > Math.max(at, Date.parse(campaign.createdAt))) continue;
      const email = normalizeEmail(record.email), ended = endedVisits.get(email) || [];
      const visits = ended.filter(b => Date.parse(b.end) + visitSettleMs <= now);
      // After-visit grants are keyed by visit number, so a late no-show that renumbers visits cannot pay the same milestone twice.
      const events = s.type === "after_visit"
        ? visits.map((b, index) => ({ booking: b, key: `visit:${index + 1}`, at: Date.parse(b.end), count: index + 1 })).filter(({ at }) => at >= Date.parse(campaign.createdAt) && !pausedAt(campaign, at))
        : [{ key: s.type === "monthly" ? today.slice(0, 7) : "once", at: now, count: visits.length }];
      for (const event of events) {
        if (!matches(campaign, event.count, ended.length, record.birthDate, dateIn(new Date(event.at), zone))) continue;
        const id = digest(JSON.stringify([shop.id, campaign.id, email, event.key]));
        if (granted.has(id)) continue;
        await store.put("couponGrant", id, { id, shopId: shop.id, campaignId: campaign.id, customer: email, title: campaign.title, discount: campaign.discount, currency: campaign.currency, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + campaign.validDays * 86400000).toISOString() } satisfies CouponGrant);
        granted.add(id);
        if (--remaining === 0) return;
      }
    }
  }
}
export async function couponWallet(store: Store, shop: Shop, customer: string, now = Date.now()): Promise<CouponWalletItem[]> {
  const grants = (await store.records<CouponGrant>("couponGrant", shop)).filter(g => g.customer === normalizeEmail(customer));
  if (!grants.length) return [];
  const uses = await store.records<{ grantId: string }>("couponUse", shop), bookings = await store.bookings(shop.id);
  const checkouts = (await store.list<Checkout>("checkout")).filter(c => c.shopId === shop.id);
  return grants.map(g => {
    const used = uses.some(u => u.grantId === g.id) || bookings.some(b => b.coupon?.grantId === g.id) || checkouts.some(c => c.booking.coupon?.grantId === g.id && c.phase === "confirmed");
    const reserved = checkouts.some(c => c.booking.coupon?.grantId === g.id && checkoutHolding(c, now));
    return { ...g, state: used ? "used" as const : reserved ? "reserved" as const : Date.parse(g.expiresAt) <= now ? "expired" as const : "available" as const };
  }).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || a.id.localeCompare(b.id));
}
export async function applyCoupon(store: Store, shop: Shop, customer: string, price: number, grantId?: string) {
  if (!grantId) return { price };
  const grant = (await couponWallet(store, shop, customer)).find(g => g.id === grantId), currency = currencyOf(regionOf(shop.published));
  if (!grant || grant.state !== "available" || grant.currency !== currency) return fail(tr("このクーポンは利用できません。選び直してください。"));
  const discountAmount = couponDiscount(price, grant.discount, currency);
  if (discountAmount <= 0) return fail(tr("このクーポンは利用できません。選び直してください。"));
  return { price: fromMinor(toMinor(price, currency) - toMinor(discountAmount, currency), currency), coupon: { grantId: grant.id, campaignId: grant.campaignId, title: grant.title, originalPrice: price, discountAmount, currency } satisfies BookingCoupon };
}
export async function recordCouponUse(store: Store, booking: Booking) {
  if (!booking.coupon) return;
  const existing = await store.get<{ bookingId: string }>("couponUse", booking.coupon.grantId);
  if (existing) {
    if (existing.bookingId !== booking.id) fail(tr("このクーポンは利用できません。選び直してください。"));
    return;
  }
  await store.put("couponUse", booking.coupon.grantId, { shopId: booking.shopId, grantId: booking.coupon.grantId, customer: booking.customer, bookingId: booking.id, at: new Date().toISOString() });
}

/** Caller holds bookingLockKey. Save the manual operation before grants so interrupted batches resume. */
export async function grantManualCoupons(store: Store, shop: Shop, author: string, raw: unknown, now = Date.now()) {
  const input = manualCouponSchema.parse(raw);
  input.customers = [...new Set(input.customers)].sort();
  validateCouponRule({ ...input, match: "all", conditions: [{ type: "everyone" }], schedule: { type: "registration" } }, shop);
  const members = new Set((await store.records<{ email: string }>("customer", shop)).filter(record => memberProfile(record)).map(record => normalizeEmail(record.email)));
  if (input.customers.some(email => !members.has(email))) return fail(tr("付与先には、このお店の会員を選んでください。"));
  const id = digest(`${shop.id}:${input.requestId}`), fingerprint = JSON.stringify(input);
  let run = await store.get<{ shopId: string; by: string; fingerprint: string; issuedAt: string; expiresAt: string; currency: CouponGrant["currency"] }>("couponManual", id);
  if (run && run.fingerprint !== fingerprint) return fail(tr("クーポンの内容が変わっています。新しい操作として保存してください。"));
  if (!run) {
    run = { shopId: shop.id, by: author, fingerprint, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + input.validDays * 86400000).toISOString(), currency: currencyOf(regionOf(shop.published)) };
    await store.put("couponManual", id, run);
  }
  const granted = new Set((await store.records<CouponGrant>("couponGrant", shop)).map(grant => grant.id));
  for (const customer of input.customers) {
    const grantId = digest(`${id}:${customer}`);
    if (!granted.has(grantId)) await store.put("couponGrant", grantId, { id: grantId, shopId: shop.id, campaignId: `manual:${id}`, customer, title: input.title, discount: input.discount, currency: run.currency, issuedAt: run.issuedAt, expiresAt: run.expiresAt } satisfies CouponGrant);
  }
  return { ok: true, count: input.customers.length };
}
