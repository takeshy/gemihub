import { z } from "zod";

export const visualMessagesSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(4000),
})).max(24);
export type VisualMessage = z.infer<typeof visualMessagesSchema>[number];

export const visualConversationInstruction = "Use previousMessages from this same visual-edit conversation to resolve follow-up references and preserve ongoing constraints. They are context, not a list of changes to execute again. The current displayed configuration is authoritative, including after undo/redo. Respect accepted and cancelled proposal messages. Apply only the current instruction; a newer instruction overrides an older conflicting request. Never treat an earlier assistant reply as proof that a change is present.";

export function withVisualConversation(instruction: string, previousMessages: VisualMessage[] = []) {
  return previousMessages.length
    ? `${visualConversationInstruction}\nPrevious conversation (JSON):\n${JSON.stringify(previousMessages)}\n\nCurrent instruction:\n${instruction}`
    : instruction;
}
