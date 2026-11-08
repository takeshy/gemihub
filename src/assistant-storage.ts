import { z } from "zod";
import type { ApiClient } from "./api";
import type { ShopChat } from "../server/shop-chat";
import { createRequestId } from "./request-id";

export const savedAssistantSchema = z.object({
  messages: z.array(z.object({role:z.enum(["user","assistant"]),text:z.string().max(20000),sources:z.array(z.object({path:z.string(),title:z.string()})).optional(),voice:z.boolean().optional()})).max(100),
  pending:z.object({id:z.string(),text:z.string().max(4000)}).optional(),
  text:z.string().max(4000),draft:z.string().max(10000).optional(),planId:z.string().optional(),dismissedRequestId:z.string().optional(),
});
export const assistantStorageKey = (shopId: string, email: string, id?: string) => `gemihub:assistant:${shopId}:${email}${id ? `:${id}` : ""}`;

/** Copy the previous single local conversation before replacing its storage key. */
export async function migrateAssistantHistory(api: ApiClient, shopId: string, email: string) {
  const key = assistantStorageKey(shopId, email);
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return; }
  if (!raw) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  const legacy = savedAssistantSchema.safeParse(parsed);
  if (!legacy.success) return;
  let requestId = localStorage.getItem(`${key}:migration-id`);
  if (!requestId) { requestId = createRequestId(); localStorage.setItem(`${key}:migration-id`, requestId); }
  const chat = await api<ShopChat>(`/api/shops/${shopId}/assistant/history/import`, {requestId,messages:legacy.data.messages.filter(message => message.text.trim())});
  localStorage.setItem(assistantStorageKey(shopId, email, chat.id), JSON.stringify(legacy.data));
  localStorage.setItem(`${key}:migrated`, chat.id);
  if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
}
