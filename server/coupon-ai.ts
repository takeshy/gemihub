import { tr } from "../shared/i18n.ts";
import { couponRuleSchema } from "../shared/coupons.ts";
import { currencyOf, regionOf, dateIn } from "../shared/region.ts";
import type { Shop } from "./store.ts";
import { generateJson } from "./llm.ts";
import { z } from "zod";
const proposalSchema = z.object({ rule: couponRuleSchema.nullable(), question: z.string().max(1000) });
// Keep array limits in validation; bounded union arrays can overwhelm Vertex's grammar.
const generationSchema = proposalSchema.toJSONSchema({
  override({ jsonSchema }) {
    if (jsonSchema.type !== "array") return;
    jsonSchema.description = [jsonSchema.description, `At least ${jsonSchema.minItems} items. At most ${jsonSchema.maxItems} items.`].filter(Boolean).join(" ");
    delete jsonSchema.minItems;
    delete jsonSchema.maxItems;
  },
});
export async function proposeCoupon(shop: Shop, request: string, generate = generateJson) {
  const raw = await generate({
    system: tr("店主の依頼をクーポンの設定案にしてください。初回は来店実績0回、誕生日は会員の誕生日月、来店回数は終了した有効な予約だけを数えます。来店X回目の後はvisit_count/exactとafter_visit、X回ごとはmultiple。一周年など全員への記念配布はeveryoneとonce（具体的な日付が必要）。条件はall（すべて）かany（いずれか）で組み合わせます。registrationは既存会員にも一度だけ、monthlyは店舗時間の毎月指定日・時刻。割引率は整数1〜100%、金額は店舗通貨。依頼にない条件を増やさないでください。案だけを作り、有効化や配布はしません。"),
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ request, currency: currencyOf(regionOf(shop.published)), timeZone: regionOf(shop.published).timeZone, today: dateIn(new Date(), regionOf(shop.published).timeZone), clarification: tr("指定日の具体的な日付が不明、またはこの形式で表現できない条件は、ruleをnullにしquestionで質問してください。通常の未指定値は有効期間30日・午前9時を提案し、確定させず画面で確認してもらいます。") }) }] }], schema: generationSchema, timeoutMs: 15000,
  });
  return proposalSchema.parse(JSON.parse(raw));
}
