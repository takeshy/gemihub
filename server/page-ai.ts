import { tr } from "../shared/i18n.ts";
import { generateJson } from "./llm.ts";
import { z } from "zod";
import { pageSchema, headerPartSchema, footerPartSchema, type ShopPage } from "./pages.ts";
import { shopSchema, type ShopConfig } from "./domain.ts";
import { requestImageParts, requestImageInstruction, type RequestImage } from "./request-images.ts";
export const profileSchema = z.object({ name: shopSchema.shape.name, industry: shopSchema.shape.industry, description: shopSchema.shape.description, address: shopSchema.shape.address, appearance: shopSchema.shape.appearance, notificationEmail: shopSchema.shape.notificationEmail, map: shopSchema.shape.map, screens: shopSchema.shape.screens, ownerBooking: shopSchema.shape.ownerBooking });
export const messageSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(12000) });
async function generate<T extends z.ZodType>(schema: T, input: unknown, instruction: string, images: RequestImage[] = []) {
  const answer = await generateJson({ unavailableMessage: tr("AI の接続がまだ設定されていません"), contents: [{ role: "user", parts: requestImageParts(input, images) }], schema: z.toJSONSchema(schema), system: instruction });
  return schema.parse(JSON.parse(answer));
}
export async function createPageWithAI(messages: z.infer<typeof messageSchema>[], context: Pick<ShopConfig, "name" | "industry" | "description" | "address">, mode: "chat" | "write", images: RequestImage[] = []) {
  const schema = z.object({ reply: z.string().min(1).max(4000), page: pageSchema.omit({ id: true }).nullable() });
  return generate(schema, { messages, context, mode }, tr("小さなお店のページ作成を日本語で手伝う。chatでは必要な情報が足りなければ短い質問を一つ返しpageはnull。writeでは要望からページ案を作る。情報が揃えばページ案と説明を返す。未確認の料金・住所・サービスを捏造しない。本文 body は HTML の断片、css はそのページだけに効く CSS にする。見出し・段落・リスト・画像・SVG・div・section などの表示用タグと CSS（レイアウト・装飾・アニメーション）を使ってよい。スクリプト、onclick などのイベント属性、フォーム・入力欄・ボタン、iframe などの埋め込み、外部 CSS・@import・CSS の url() は使わない。お店の画像は提供された ID だけを <img data-image-id=\"ID\" alt=\"説明\"> で入れる。画像URLは提供されたHTTPS URLのみ、未提供なら空文字。予約処理は作らない。slugは半角英小文字・数字・ハイフン。提案のみで公開しない。") + tr(requestImageInstruction).replace(/header\.imageId(?:・|, )pages\[\]\.imageId(?:・|, or )menus\[\]\.imageId/g, "page.imageId"), images);
}
export async function mergePageWithAI(input: { baseline: unknown; local: unknown; remote: unknown; kind: "page" | "shared" | "header" | "footer" }) {
  const valueSchema = input.kind === "page" ? pageSchema.nullable() : input.kind === "header" ? headerPartSchema : input.kind === "footer" ? footerPartSchema : profileSchema;
  const schema = z.object({ value: valueSchema, explanation: z.string().min(1).max(4000) });
  return generate(schema, input, tr("ローカルとリモートの変更を編集元baselineと比較して日本語で結合提案する。両方の意図を保持し、判断できない点を説明する。削除と編集が競合する場合は勝手に削除せず内容を残す案を優先。ページIDを変更しない。新しい事実やURLを捏造しない。Markdown以外のコードを追加しない。提案だけで公開しない。"));
}
