import { z } from "zod";
import { tr, intlLocale } from "./i18n.ts";
import { formatMoney, fromMinor, toMinor, type Currency } from "./region.ts";
export const couponConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("everyone") }), z.object({ type: z.literal("first_visit") }), z.object({ type: z.literal("birthday_month") }),
  z.object({ type: z.literal("visit_count"), count: z.number().int().min(1).max(10000), comparison: z.enum(["exact", "multiple", "at_least"]) }),
]);
export const couponRuleSchema = z.object({
  title: z.string().trim().min(1).max(100), match: z.enum(["all", "any"]), conditions: z.array(couponConditionSchema).min(1).max(10),
  discount: z.discriminatedUnion("type", [z.object({ type: z.literal("percent"), value: z.number().int().min(1).max(100) }), z.object({ type: z.literal("amount"), value: z.number().positive().max(1000000) })]),
  schedule: z.discriminatedUnion("type", [
    z.object({ type: z.literal("registration") }), z.object({ type: z.literal("after_visit") }),
    z.object({ type: z.literal("monthly"), day: z.number().int().min(1).max(31), hour: z.number().int().min(0).max(23) }),
    z.object({ type: z.literal("once"), date: z.iso.date(), hour: z.number().int().min(0).max(23) }),
  ]), validDays: z.number().int().min(1).max(365),
});
export type CouponRule = z.infer<typeof couponRuleSchema>;
export function couponRuleIssues(rule: CouponRule): { field: "conditions" | "schedule"; message: string }[] {
  const first = rule.conditions.some(c => c.type === "first_visit");
  if (rule.schedule.type === "after_visit" && (rule.match === "all" && first || rule.match === "any" && rule.conditions.every(c => c.type === "first_visit")))
    return [{ field: "schedule", message: tr("「初回来店前」は来店回数が0回のため、「来店後」には付与できません。会員登録時などを選んでください。") }];
  if (rule.match === "all") {
    const counts = rule.conditions.flatMap(c => c.type === "visit_count" ? [c] : []);
    const exact = [...(first ? [0] : []), ...counts.filter(c => c.comparison === "exact").map(c => c.count)];
    if (new Set(exact).size > 1 || exact.length && counts.some(c => c.comparison === "at_least" ? exact[0] < c.count : c.comparison === "multiple" ? exact[0] === 0 || exact[0] % c.count !== 0 : exact[0] !== c.count))
      return [{ field: "conditions", message: tr("配布条件が両立しません。初回・来店回数の条件を見直してください。") }];
  }
  return [];
}
export const couponTemplateIds = ["first", "birthday", "visits", "anniversary"] as const;
export type CouponTemplate = typeof couponTemplateIds[number];
export function couponTemplateLabel(template: CouponTemplate) {
  return { first: tr("初回クーポン"), birthday: tr("誕生日月"), visits: tr("来店回数"), anniversary: tr("記念日・全員配布") }[template];
}
export function couponTemplate(template: CouponTemplate, date: string): CouponRule {
  const base: CouponRule = { title: couponTemplateLabel(template), match: "all", conditions: [{ type: "first_visit" }], discount: { type: "percent", value: 10 }, schedule: { type: "registration" }, validDays: 30 };
  if (template === "birthday") return { ...base, conditions: [{ type: "birthday_month" }], schedule: { type: "monthly", day: 1, hour: 9 } };
  if (template === "visits") return { ...base, conditions: [{ type: "visit_count", count: 5, comparison: "exact" }], schedule: { type: "after_visit" } };
  if (template === "anniversary") return { ...base, conditions: [{ type: "everyone" }], schedule: { type: "once", date, hour: 9 } };
  return base;
}
export const manualCouponSchema = couponRuleSchema.pick({ title: true, discount: true, validDays: true }).extend({
  requestId: z.uuid(), customers: z.array(z.email().transform(email => email.trim().toLowerCase())).min(1).max(1000),
});
export type CouponCampaign = CouponRule & { id: string; shopId: string; currency: Currency; enabled: boolean; createdAt: string; updatedAt: string; pausedAt?: string; pausedRanges?: { from: string; to: string }[] };
export type CouponGrant = { id: string; shopId: string; campaignId: string; customer: string; title: string; discount: CouponRule["discount"]; currency: Currency; issuedAt: string; expiresAt: string };
export type CouponWalletItem = CouponGrant & { state: "available" | "reserved" | "used" | "expired" };
export type BookingCoupon = { grantId: string; campaignId: string; title: string; originalPrice: number; discountAmount: number; currency: Currency };
export function couponDiscount(price: number, discount: CouponRule["discount"], currency: Currency) {
  const total = toMinor(price, currency);
  return fromMinor(Math.min(total, discount.type === "percent" ? Math.floor(total * discount.value / 100) : toMinor(discount.value, currency)), currency);
}
export function couponDiscountLabel(discount: CouponRule["discount"], currency: Currency) {
  return discount.type === "percent" ? tr("{0}%割引", discount.value) : tr("{0}割引", formatMoney(discount.value, currency, intlLocale()));
}
export function couponConditionLabel(c: CouponRule["conditions"][number]) {
  if (c.type === "everyone") return tr("会員全員");
  if (c.type === "first_visit") return tr("初回来店前（来店実績0回）");
  if (c.type === "birthday_month") return tr("誕生日月");
  return c.comparison === "multiple" ? tr("来店{0}回ごと", c.count) : c.comparison === "at_least" ? tr("来店{0}回以上", c.count) : tr("来店{0}回目の後", c.count);
}
export function couponScheduleLabel(s: CouponRule["schedule"]) {
  if (s.type === "registration") return tr("会員登録時（既存会員も一度だけ）");
  if (s.type === "after_visit") return tr("来店後（予約終了の24時間後）");
  return s.type === "monthly" ? tr("毎月{0}日 {1}時", s.day, s.hour) : tr("{0} {1}時に一度だけ", s.date, s.hour);
}
