export const MAX_PROMPT_HISTORY = 100;

export function promptHistoryStorageKey(scope: string): string {
  return `gemihub:chat-prompt-history:${scope || "default"}`;
}

export function parsePromptHistory(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((prompt): prompt is string => typeof prompt === "string" && prompt.trim().length > 0)
      .slice(-MAX_PROMPT_HISTORY);
  } catch {
    return [];
  }
}

export function appendPromptHistory(history: string[], prompt: string): string[] {
  const trimmed = prompt.trim();
  if (!trimmed) return history;
  return [...history, trimmed].slice(-MAX_PROMPT_HISTORY);
}

export function isCaretOnFirstLine(value: string, caret: number): boolean {
  return !value.slice(0, caret).includes("\n");
}

export function isCaretOnLastLine(value: string, caret: number): boolean {
  return !value.slice(caret).includes("\n");
}
