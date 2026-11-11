// The chat label names the model family the server is configured to use, rather than a generic "AI".
// The session sets it before any chat is shown; Gemini is the server's default provider.
export type AiName = "Gemini" | "GPT";
let current: AiName = "Gemini";
export const aiName = () => current;
export function setAiName(name: AiName | undefined) { if (name) current = name; }
