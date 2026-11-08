import { z } from "zod";

export const savedAssistantSchema = z.object({
  messages: z.array(z.object({role:z.enum(["user","assistant"]),text:z.string().max(20000),sources:z.array(z.object({path:z.string(),title:z.string()})).optional(),voice:z.boolean().optional()})).max(100),
  pending:z.object({id:z.string(),text:z.string().max(4000)}).optional(),
  text:z.string().max(4000),draft:z.string().max(10000).optional(),planId:z.string().optional(),dismissedRequestId:z.string().optional(),
});
export const assistantStorageKey = (shopId: string, email: string, id?: string) => `gemihub:assistant:${shopId}:${email}${id ? `:${id}` : ""}`;
