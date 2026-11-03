import { tr } from "../shared/i18n.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Shop, Store } from "./store.ts";
import { chatLabels, openingQuestions, requestIntentSchema, type RequestIntent } from "./request-intent.ts";
import { findRelevantHistory } from "./chat-context.ts";

export type ShopConversation = { id: string; shopId: string; email: string; intent: RequestIntent; title: string; createdAt: string; updatedAt: string };
export type ShopChatMessage = { id: string; shopId: string; conversationId: string; email: string; role: "user" | "assistant"; text: string; requestId: string; sequence: number; createdAt: string; updatedAt: string; detail: { article?:{title:string;excerpt:string;body:string}; imageIds?: string[]; changeRequest?: boolean; ready?: boolean; planId?: string; partial?: boolean } };
export type ShopChat = ShopConversation & { messages: ShopChatMessage[] };
export const conversationInputSchema = z.object({ intent: requestIntentSchema, requestId: z.uuid(), begin:z.boolean().optional() });
export const chatReferenceSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.uuid() });
export type ChatReference = z.infer<typeof chatReferenceSchema>;
export function conversationContext(chat: ShopChat, limit=24) {
  return chat.messages.slice(-limit).map(message=>({role:message.role,text:(message.detail.partial?tr("（途中で終了した発言）{0}", message.text):message.text)+(message.detail.imageIds?.length?`\nAttached image IDs: ${message.detail.imageIds.join(", ")}`:"")}));
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export async function conversations(store: Store, shop: Shop, email: string) {
  return (await store.records<ShopConversation>("shopChat", shop)).filter(chat => chat.email === email).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function searchConversationHistory(store:Store,shop:Shop,email:string,query:string,excludedIds:ReadonlySet<string>=new Set()) {
  const own = await conversations(store,shop,email);
  const intents = new Map(own.map(chat=>[chat.id,chat.intent]));
  const messages = (await store.records<ShopChatMessage>("shopChatMessage",shop)).filter(message=>message.requestId!=="opening"&&message.email===email&&message.shopId===shop.id&&intents.has(message.conversationId));
  return findRelevantHistory(messages,intents,query,excludedIds);
}
export async function readConversation(store: Store, shop: Shop, email: string, id: string): Promise<ShopChat> {
  const chat = (await conversations(store, shop, email)).find(chat => chat.id === id);
  if (!chat) throw Object.assign(new Error(tr("チャットが見つかりません")), {status:404});
  const messages = (await store.records<ShopChatMessage>("shopChatMessage", shop)).filter(message => message.conversationId === id && message.email === email).sort((a,b) => a.sequence - b.sequence);
  return {...chat,messages};
}
export async function createConversation(store: Store, shop: Shop, email: string, intent: RequestIntent, requestId: string, begin=false): Promise<ShopChat> {
  const id = digest(`${shop.id}:${email}:${requestId}`);
  const previous = (await conversations(store, shop, email)).find(chat => chat.id === id);
  if (previous && previous.intent !== intent) throw Object.assign(new Error(tr("作成するチャットの種類が変わっています")),{status:409});
  if (!previous) {
    const now = new Date().toISOString();
    await store.put("shopChat",id,{id,shopId:shop.id,email,intent,title:chatLabels[intent],createdAt:now,updatedAt:now} satisfies ShopConversation);
  }
  const chat=await readConversation(store,shop,email,id);
  if(begin&&!chat.messages.length)await appendChatMessage(store,shop,chat,{role:"assistant",text:openingQuestions[intent],requestId:"opening"});
  return readConversation(store,shop,email,id);
}
export async function appendChatMessage(store: Store, shop: Shop, chat: ShopConversation, input: Pick<ShopChatMessage,"role"|"text"|"requestId"> & { detail?: ShopChatMessage["detail"] }): Promise<ShopChatMessage> {
  if (!input.text.trim() || input.text.length > 12000) throw Object.assign(new Error(tr("チャットの文章は12000文字以内にしてください")),{status:400});
  const id = digest(`${chat.id}:${input.requestId}:${input.role}`);
  const records = await store.records<ShopChatMessage>("shopChatMessage",shop);
  const previous = records.find(message => message.id === id);
  if (previous) {
    if (previous.text !== input.text || JSON.stringify(previous.detail.imageIds || []) !== JSON.stringify(input.detail?.imageIds || [])) throw Object.assign(new Error(tr("送信済みの内容が変わっています。新しいメッセージとして送信してください")),{status:409});
    return previous;
  }
  const now = new Date().toISOString();
  const message: ShopChatMessage = {id,shopId:shop.id,conversationId:chat.id,email:chat.email,role:input.role,text:input.text,requestId:input.requestId,sequence:records.reduce((maximum,item)=>item.conversationId===chat.id?Math.max(maximum,item.sequence):maximum,0)+1,createdAt:now,updatedAt:now,detail:input.detail || {}};
  await store.put("shopChatMessage",id,message);
  const latest = (await conversations(store,shop,chat.email)).find(item => item.id === chat.id) || chat;
  const title = latest.title === chatLabels[chat.intent] && input.role === "user" ? input.text.replace(/\s+/g," ").slice(0,60) : latest.title;
  await store.put("shopChat",chat.id,{...latest,title,updatedAt:now});
  return message;
}
export async function attachChatPlan(store: Store, shop: Shop, email: string, reference: {id:string;requestId:string}, planId: string) {
  const chat = await readConversation(store,shop,email,reference.id);
  const reply = chat.messages.find(message => message.role === "assistant" && message.requestId === reference.requestId);
  if (!reply) throw Object.assign(new Error(tr("変更案の元になった会話が見つかりません")),{status:409});
  if (reply.detail.planId && reply.detail.planId !== planId) throw Object.assign(new Error(tr("この会話にはすでに変更案があります")),{status:409});
  await store.put("shopChatMessage",reply.id,{...reply,detail:{...reply.detail,planId},updatedAt:new Date().toISOString()});
}
