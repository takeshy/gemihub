import type { KanbanChecklistItem } from "./kanban-task";

export interface KanbanAiTask {
  title: string;
  description: string;
  due: string;
  checklist: KanbanChecklistItem[];
}

export const KANBAN_AI_SOURCE = `Convert the user's request into one or more actionable tasks.
Today is {{today}}.
Return ONLY a JSON array. Each item must have this exact shape:
{"title":"short task title","description":"helpful detail or empty string","due":"YYYY-MM-DD or empty string","checklist":[{"text":"subtask","completed":false}]}
Resolve relative dates from today. Do not invent a deadline. Keep the user's language.`;

function validIsoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

export function parseKanbanAiTasks(value: string): KanbanAiTask[] {
  const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("AI response must be a JSON array.");
  const tasks = parsed.flatMap((item): KanbanAiTask[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) return [];
    const checklist = Array.isArray(record.checklist)
      ? record.checklist.flatMap((entry): KanbanChecklistItem[] => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const row = entry as Record<string, unknown>;
          const text = String(row.text ?? "").trim();
          return text ? [{ text, completed: Boolean(row.completed) }] : [];
        })
      : [];
    return [{
      title,
      description: typeof record.description === "string" ? record.description.trim() : "",
      due: validIsoDate(record.due),
      checklist,
    }];
  });
  if (tasks.length === 0) throw new Error("AI did not return any valid tasks.");
  return tasks.slice(0, 20);
}

export async function generateKanbanTasks(request: string, today: string): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: request, timestamp: Date.now() }],
      model: "gemini-3.7-flash",
      systemPrompt: KANBAN_AI_SOURCE.replace("{{today}}", today),
    }),
  });
  if (!response.ok) throw new Error(`Chat API error: ${response.status}`);
  let result = "";
  for (const line of (await response.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const data = JSON.parse(line.slice(6)) as { type?: string; content?: string; error?: string };
      if (data.type === "error") throw new Error(data.error || data.content || "AI request failed.");
      if (data.type === "text" && data.content) result += data.content;
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  parseKanbanAiTasks(result);
  return result.trim();
}
