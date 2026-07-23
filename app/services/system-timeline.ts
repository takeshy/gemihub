import type { ToolDefinition } from "~/types/settings";
import {
  appendEntryBlock,
  buildEntryBlock,
  deleteEntry,
  parseMemoFile,
  replaceEntryBody,
  uniqueEntryId,
} from "~/dashboard/memo/memoTimeline";
import { findFileByNameLocal, readFileLocal } from "~/services/drive-local";
import { mutateTimelineFile } from "~/services/timeline-drive";

export const SYSTEM_TIMELINE_NAME = "Timeline";
export const SYSTEM_TIMELINE_ROOT = "Dashboards/Timeline/Timeline";

export function localDateKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === value;
}

export function systemTimelinePath(date = localDateKey()): string {
  return `${SYSTEM_TIMELINE_ROOT}/${date}.md`;
}

export function buildTimelineEntry(current: string, body: string, now = new Date()): string {
  return appendEntryBlock(
    current,
    "timeline:Timeline",
    buildEntryBlock({
      createdAt: now.toISOString(),
      id: uniqueEntryId(current, now),
      body: body.trim(),
    }),
  );
}

export async function appendSystemTimeline(body: string, date = new Date()): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const path = systemTimelinePath(localDateKey(date));
  await mutateTimelineFile(path, (current) => buildTimelineEntry(current, trimmed));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dashboard-data-changed", { detail: { path } }));
  }
}

export async function updateSystemTimelineEntry(date: string, id: string, body: string): Promise<void> {
  if (!isDateKey(date)) throw new Error("date must be YYYY-MM-DD");
  await mutateTimelineFile(systemTimelinePath(date), (current) => replaceEntryBody(current, id, body.trim()));
}

export async function deleteSystemTimelineEntry(date: string, id: string): Promise<void> {
  if (!isDateKey(date)) throw new Error("date must be YYYY-MM-DD");
  await mutateTimelineFile(systemTimelinePath(date), (current) => deleteEntry(current, id));
}

export async function readSystemTimeline(date = localDateKey()): Promise<{
  date: string;
  path: string;
  content: string;
  entries: Array<{ id: string; createdAt: string; content: string }>;
}> {
  if (!isDateKey(date)) throw new Error("date must be YYYY-MM-DD");
  const path = systemTimelinePath(date);
  const file = await findFileByNameLocal(path);
  const content = file ? await readFileLocal(file.id) : "";
  const entries = parseMemoFile(content).entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    content: entry.body || entry.quote,
  }));
  return { date, path, content, entries };
}

export const TIMELINE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_timeline",
    description: "Read the user's GemiHub Timeline for a local calendar date. Use this before answering what the user did today or on a specific day.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Local date in YYYY-MM-DD. Defaults to today." },
      },
    },
  },
  {
    name: "append_timeline",
    description: "Append a note or activity to today's GemiHub Timeline.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown content to append." },
      },
      required: ["content"],
    },
  },
];

export async function executeTimelineTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "read_timeline") {
    const date = typeof args.date === "string" && args.date ? args.date : localDateKey();
    return readSystemTimeline(date);
  }
  if (name === "append_timeline") {
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) return { error: "content is required" };
    await appendSystemTimeline(content);
    return { appended: true, date: localDateKey(), path: systemTimelinePath() };
  }
  return { error: `Unknown Timeline tool: ${name}` };
}

export const TIMELINE_AI_INSTRUCTION = [
  "## GemiHub Timeline",
  "When the user asks what they did today or on a specific date, call read_timeline before answering.",
  "When the user asks you to remember, record, or add something to their Timeline, call append_timeline.",
  "Treat Timeline entries as the user's activity record and clearly distinguish scheduled calendar entries from completed activity.",
].join("\n");
