import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import type { Shop, Store } from "./store.ts";
import { appendChatMessage, readConversation, type ChatReference, type ConsultationReply, type ShopChat, type ShopConversation, type ShopChatMessage } from "./shop-chat.ts";

const sourcesSchema = z.array(z.object({ path: z.string().max(2000), title: z.string().max(500) })).max(100);
export const consultationVoiceSchema = z.object({ requestId: z.uuid(), question: z.string().max(20000).default(""), answer: z.string().max(20000), sources: sourcesSchema.default([]), voice:z.boolean().default(true) }).strict();
const lockKey = (id: string) => `consultation:${id}`;
async function read(store: Store, shop: Shop, email: string, id: string) {
  const chat = await readConversation(store, shop, email, id);
  if (chat.intent !== "consult") throw Object.assign(new Error(tr("チャットが見つかりません")), {status:404});
  return chat;
}
// Voice turns may save a question without an answer; failed text questions are only context noise.
const unanswered = (chat: ShopChat, message: ShopChatMessage) => message.role === "user" && !message.detail.voice && !chat.messages.some(reply => reply.role === "assistant" && reply.requestId === message.requestId);
const storedReply = (message: ShopChatMessage): ConsultationReply => ({ answer: message.text, sources: [], ...message.detail.consultation });
export async function answerConsultation(store: Store, shop: Shop, email: string, reference: ChatReference, question: string, generate: (messages: {role:"user"|"assistant";text:string}[]) => Promise<ConsultationReply>) {
  // Hold the conversation lock only around writes so deletes and voice turns are not blocked by the model call.
  const prepared = await store.locked(lockKey(reference.id), async () => {
    const chat = await read(store, shop, email, reference.id);
    // Save before invoking the model. The request ID resumes a lost response without another turn.
    await appendChatMessage(store, shop, chat, {role:"user",text:question,requestId:reference.requestId});
    const saved = await read(store, shop, email, reference.id);
    const previous = saved.messages.find(message => message.role === "assistant" && message.requestId === reference.requestId);
    if (previous) return { reply: storedReply(previous) };
    const history = saved.messages.filter(message => message.requestId !== reference.requestId && message.requestId !== "opening" && !unanswered(saved, message)).slice(-12).map(({role,text}) => ({role,text:text.slice(0,4000)}));
    return { chat: saved, history };
  });
  if ("reply" in prepared) return prepared.reply;
  const reply = await generate(prepared.history!);
  return store.locked(lockKey(reference.id), async () => {
    // A concurrent retry of the same request may have answered first; keep the stored answer.
    const previous = (await read(store, shop, email, reference.id)).messages.find(message => message.role === "assistant" && message.requestId === reference.requestId);
    if (previous) return storedReply(previous);
    const {answer, ...detail} = reply;
    await appendChatMessage(store, shop, prepared.chat!, {role:"assistant",text:answer,requestId:reference.requestId,detail:{consultation:detail}});
    return reply;
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
    // Erase bodies before hiding the conversation, so a failure leaves it listed and the delete can be retried.
    for (const message of await store.records<ShopChatMessage>("shopChatMessage", shop)) if (message.conversationId === id && message.email === email && (message.text || Object.keys(message.detail).length)) await store.put("shopChatMessage", message.id, {...message,text:"",detail:{},updatedAt:new Date().toISOString()});
    await store.put("shopChat", id, {...chat, title:tr("削除済みの相談"), deletedAt: chat.deletedAt || new Date().toISOString()});
    await store.delete("shopChatGeneration", id);
    return {ok:true};
  });
}
