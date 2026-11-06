import { tr, getLocale } from "../shared/i18n.ts";
import { couponRuleSchema, couponTemplate } from "../shared/coupons.ts";
import { currencyOf, regionOf, dateIn } from "../shared/region.ts";
import type { Shop } from "./store.ts";
import { generateJson } from "./llm.ts";
import { z } from "zod";
const invalidProposal = () => Object.assign(new Error(tr("クーポン案を作成できませんでした。もう一度お試しください。")), { status: 502 });
const proposalRuleSchema = couponRuleSchema.extend({
  discount: couponRuleSchema.shape.discount.describe('Only {"type":"percent","value":10} for percentage discounts or {"type":"amount","value":5} for fixed currency amounts. For $5 off in USD use amount with value 5, not 500 cents. Never emit fixed or fixed_amount as the type. Values use the shop currency, without conversion.'),
  conditions: couponRuleSchema.shape.conditions.describe('Use {"type":"first_visit"} for first-time customers with zero completed visits. This dedicated condition has no count or comparison fields. Do not represent zero visits with visit_count, whose count must be at least 1. Use birthday_month for birthdays, everyone for all members, and visit_count for completed-visit milestones.'),
  schedule: couponRuleSchema.shape.schedule.describe('For first_visit, default to {"type":"registration"} when timing is unspecified; this also covers existing members with no completed visits. Use after_visit with visit_count for offers after a completed visit, never with first_visit.'),
});
const proposalSchema = z.object({
  rule: proposalRuleSchema.nullable().describe("Return a complete reviewable rule for supported requests, including first-time customer offers. Null is only for genuinely missing essential information or unsupported conditions."),
  question: z.string().max(1000).describe("Empty when rule is present. If clarification is necessary, ask in the requested language."),
});
// Keep array limits in validation; bounded union arrays can overwhelm Vertex's grammar.
const generationSchema = proposalSchema.toJSONSchema({
  override({ jsonSchema }) {
    if (jsonSchema.type !== "array") return;
    jsonSchema.description = [jsonSchema.description, `At least ${jsonSchema.minItems} items. At most ${jsonSchema.maxItems} items.`].filter(Boolean).join(" ");
    delete jsonSchema.minItems;
    delete jsonSchema.maxItems;
  },
});
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function normalizeDiscount(proposal: unknown) {
  // Normalize only unambiguous model aliases; numeric values still undergo full validation.
  if (isRecord(proposal) && isRecord(proposal.rule) && isRecord(proposal.rule.discount)) {
    const discount = proposal.rule.discount;
    if (discount.type === "fixed" || discount.type === "fixed_amount") discount.type = "amount";
  }
  return proposal;
}
export async function proposeCoupon(shop: Shop, request: string, generate = generateJson) {
  const currency = currencyOf(regionOf(shop.published)), fixedAmount = currency === "USD" ? 5 : 500;
  const raw = await generate({
    system: tr("店主の依頼をクーポンの設定案にしてください。「初めてのお客様」「初回来店前」「first-time customers」は専用の条件 {\"type\":\"first_visit\"} で表現します。これは完了した来店が0回という意味で、countやcomparisonは付けません。visit_countの最小値1はこの専用条件には関係ありません。初回向けで付与タイミングが未指定なら {\"type\":\"registration\"} を提案し、登録時か来店後かを質問しないでください。registrationは既存の来店実績0回の会員にも一度だけ付与できます。「初回の来店後」は別の条件で、{\"type\":\"visit_count\",\"count\":1,\"comparison\":\"exact\"} と {\"type\":\"after_visit\"} を使います。誕生日月は {\"type\":\"birthday_month\"}、全会員は {\"type\":\"everyone\"}。来店回数は終了した有効な予約だけを数え、来店X回目の後はvisit_count/exactとafter_visit、X回ごとはmultiple。一周年など全員への記念配布はeveryoneとonce（具体的な日付が必要）。条件はall（すべて）かany（いずれか）で組み合わせ、monthlyは店舗時間の毎月指定日・時刻。割引率は整数1〜100%、金額は店舗通貨。依頼にない条件を増やさず、examplesのJSON形式を参考にしてください。タイトルと質問はlanguageで指定された言語で返します。案だけを作り、有効化や配布はしません。") + " " + tr("割引のtypeはpercentとamountだけです。10%引きは {\"type\":\"percent\",\"value\":10}、固定額の割引は {\"type\":\"amount\",\"value\":金額} にします。USDの$5引きはvalueを5にし、500セントにはしません。fixedやfixed_amountは使わず、金額は店舗通貨で扱い、通貨換算はしません。「3回来店したお客様」はvisit_countのcount:3とcomparison:exact、「3回ごと」はmultiple、「3回以上」はat_leastです。「来店ごとに計算」はscheduleのafter_visitで表します。"),
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ request, language: getLocale(), examples: [
      { request: "10% off for first-time customers, valid 30 days", result: { rule: couponTemplate("first", ""), question: "" } },
      { request: "10% off after the first completed visit, valid 30 days", result: { rule: { ...couponTemplate("first", ""), conditions: [{ type: "visit_count", count: 1, comparison: "exact" }], schedule: { type: "after_visit" } }, question: "" } },
      { request: `${currency === "USD" ? "$5" : "JPY 500"} off for customers who have visited 3 times, valid 60 days, calculated after each visit`, result: { rule: { ...couponTemplate("visits", ""), conditions: [{ type: "visit_count", count: 3, comparison: "exact" }], discount: { type: "amount", value: fixedAmount }, schedule: { type: "after_visit" }, validDays: 60 }, question: "" } },
    ], currency, timeZone: regionOf(shop.published).timeZone, today: dateIn(new Date(), regionOf(shop.published).timeZone), clarification: tr("指定日の具体的な日付が不明、または対応できない条件だけ、ruleをnullにしquestionで質問してください。初回向けの依頼はfirst_visitで対応できます。通常の未指定値は有効期間30日・午前9時を提案し、初回向けの付与タイミングが未指定ならregistrationを提案します。案を返す場合はquestionを空にし、確定させず画面で確認してもらいます。") }) }] }], schema: generationSchema, timeoutMs: 15000,
  });
  try {
    const proposal = proposalSchema.parse(normalizeDiscount(JSON.parse(raw)));
    if (!proposal.rule && !proposal.question.trim()) throw invalidProposal();
    return proposal;
  } catch {
    throw invalidProposal();
  }
}
