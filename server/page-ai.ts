import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { pageSchema, headerSchema, footerSchema, type ShopPage } from "./pages.ts";
import { shopSchema, type ShopConfig } from "./domain.ts";
export const profileSchema = z.object({ name: shopSchema.shape.name, industry: shopSchema.shape.industry, description: shopSchema.shape.description, address: shopSchema.shape.address, appearance: shopSchema.shape.appearance, notificationEmail: shopSchema.shape.notificationEmail });
export const messageSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(12000) });
async function generate<T extends z.ZodType>(schema: T, input: unknown, instruction: string) {
  if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.VERTEX_MODEL) throw Object.assign(new Error("AI の接続がまだ設定されていません"), { status: 503 });
  const ai = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION || "global" });
  const response = await ai.models.generateContent({ model: process.env.VERTEX_MODEL, contents: JSON.stringify(input), config: { responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(schema), systemInstruction: instruction } });
  return schema.parse(JSON.parse(response.text || "{}"));
}
export async function createPageWithAI(messages: z.infer<typeof messageSchema>[], context: Pick<ShopConfig, "name" | "industry" | "description" | "address">, mode: "chat" | "write") {
  const schema = z.object({ reply: z.string().min(1).max(4000), page: pageSchema.omit({ id: true }).nullable() });
  return generate(schema, { messages, context, mode }, "小さなお店のページ作成を日本語で手伝う。chatでは必要な情報が足りなければ短い質問を一つ返しpageはnull。writeでは要望からページ案を作る。情報が揃えばページ案と説明を返す。未確認の料金・住所・サービスを捏造しない。本文は安全なMarkdown。画像URLは提供されたHTTPS URLのみ、未提供なら空文字。HTMLやスクリプトや予約処理は生成しない。slugは半角英小文字・数字・ハイフン。提案のみで公開しない。");
}
export async function mergePageWithAI(input: { baseline: unknown; local: unknown; remote: unknown; kind: "page" | "shared" | "header" | "footer" }) {
  const valueSchema = input.kind === "page" ? pageSchema.nullable() : input.kind === "header" ? headerSchema : input.kind === "footer" ? footerSchema : profileSchema;
  const schema = z.object({ value: valueSchema, explanation: z.string().min(1).max(4000) });
  return generate(schema, input, "ローカルとリモートの変更を編集元baselineと比較して日本語で結合提案する。両方の意図を保持し、判断できない点を説明する。削除と編集が競合する場合は勝手に削除せず内容を残す案を優先。ページIDを変更しない。新しい事実やURLを捏造しない。Markdown以外のコードを追加しない。提案だけで公開しない。");
}
