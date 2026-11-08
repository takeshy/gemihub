import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import type { Shop, Store } from "./store.ts";
import { appendChatMessage, createConversation, readConversation, type ChatReference, type ConsultationReply, type ShopConversation, type ShopChatMessage } from "./shop-chat.ts";

const sourcesSchema = z.array(z.object({ path: z.string().max(2000), title: z.string().max(500) })).max(100);
export const consultationImportSchema = z.object({ requestId: z.uuid(), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(20000), sources: sourcesSchema.optional(), voice: z.boolean().optional() })).max(100) }).strict();
export const consultationVoiceSchema = z.object({ requestId: z.uuid(), question: z.string().max(4000).default(""), answer: z.string().max(20000), sources: sourcesSchema.default([]), voice:z.boolean().default(true) }).strict();
const lockKey = (id: string) => `consultation:${id}`;
async function read(store: Store, shop: Shop, email: string, id: string) {
  const chat = await readConversation(store, shop, email, id);
  if (chat.intent !== "consult") throw Object.assign(new Error(tr("チャットが見つかりません")), {status:404});
  return chat;
}
export async function answerConsultation(store: Store, shop: Shop, email: string, reference: ChatReference, question: string, generate: (messages: {role:"user"|"assistant";text:string}[]) => Promise<ConsultationReply>) {
  return store.locked(lockKey(reference.id), async () => {
    let chat = await read(store, shop, email, reference.id);
    // Save before invoking the model. The request ID resumes a lost response without another turn.
    await appendChatMessage(store, shop, chat, {role:"user",text:question,requestId:reference.requestId});
    chat = await read(store, shop, email, reference.id);
    const previous = chat.messages.find(message => message.role === "assistant" && message.requestId === reference.requestId);
    if (previous) return { answer: previous.text, sources: [], ...previous.detail.consultation };
    const history = chat.messages.filter(message => message.requestId !== reference.requestId && message.requestId !== "opening").slice(-12).map(({role,text}) => ({role,text:text.slice(0,4000)}));
    const reply = await generate(history);
    const {answer, ...detail} = reply;
    await appendChatMessage(store, shop, chat, {role:"assistant",text:answer,requestId:reference.requestId,detail:{consultation:detail}});
    return reply;
  });
}
export async function importConsultation(store: Store, shop: Shop, email: string, input: z.infer<typeof consultationImportSchema>) {
  return store.locked(`consultation-import:${shop.id}:${email}:${input.requestId}`, async () => {
    const chat = await createConversation(store, shop, email, "consult", input.requestId);
    return store.locked(lockKey(chat.id), async () => {
      for (const [index, message] of input.messages.entries()) await appendChatMessage(store, shop, chat, {role:message.role,text:message.text,requestId:`legacy-${index}`,detail:{voice:message.voice, ...(message.role === "assistant" ? {consultation:{sources:message.sources || []}} : {})}});
      return read(store, shop, email, chat.id);
    });
  });
}
export async function appendVoiceConsultation(store: Store, shop: Shop, email: string, id: string, input: z.infer<typeof consultationVoiceSchema>) {
  return store.locked(lockKey(id), async () => {
    const chat = await read(store, shop, email, id);
    if (input.question.trim()) await appendChatMessage(store, shop, chat, {role:"user",text:input.question,requestId:input.requestId,detail:{voice:input.voice}});
    if (input.answer.trim()) await appendChatMessage(store, shop, chat, {role:"assistant",text:input.answer,requestId:input.requestId,detail:{voice:input.voice,consultation:{sources:input.sources}}});
    return {ok:true};
  });
}
export async function deleteConsultation(store: Store, shop: Shop, email: string, id: string) {
  return store.locked(lockKey(id), async () => {
    const chat = await store.get<ShopConversation>("shopChat", id);
    if (!chat || chat.shopId !== shop.id || chat.email !== email || chat.intent !== "consult") throw Object.assign(new Error(tr("チャットが見つかりません")), {status:404});
    await store.put("shopChat", id, {...chat, title:tr("削除済みの相談"), deletedAt: chat.deletedAt || new Date().toISOString()});
    for (const message of await store.records<ShopChatMessage>("shopChatMessage", shop)) if (message.conversationId === id && message.email === email) await store.put("shopChatMessage", message.id, {...message,text:"",detail:{},updatedAt:new Date().toISOString()});
    await store.delete("shopChatGeneration", id);
    return {ok:true};
  });
}
