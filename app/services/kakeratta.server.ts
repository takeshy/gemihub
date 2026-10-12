import { McpClient } from "./mcp-client.server";
import { validateMcpServerUrl } from "./url-validator.server";
import type { KakerattaCall } from "./kakeratta-worker";
import type { KakerattaSettings } from "~/types/kakeratta";
import { KakerattaRejectedError } from "./kakeratta-errors";

const TOOLS = new Set(["sync_timeline", "list_personas", "list_asks", "claim_ask", "read_for_ask", "submit_answer", "release_ask", "claim_request", "reply_request", "comment_on_entry", "get_timeline", "get_thread", "search_timeline", "list_schedules", "list_notes", "read_note"]);
const polls = new Map<string, AbortController>();

export function beginKakerattaPoll(rootFolderId: string): AbortController | null {
  if (polls.has(rootFolderId)) return null;
  const controller = new AbortController();
  polls.set(rootFolderId, controller);
  return controller;
}

export function stopKakerattaPoll(rootFolderId: string): void {
  polls.get(rootFolderId)?.abort();
}

export function endKakerattaPoll(rootFolderId: string): void {
  polls.delete(rootFolderId);
}

export function validateKakerattaUrl(config: KakerattaSettings): void {
  if (config.url || config.enabled) validateMcpServerUrl(config.url);
}

export async function withKakeratta<T>(config: KakerattaSettings, signal: AbortSignal, work: (call: KakerattaCall) => Promise<T>): Promise<T> {
  validateKakerattaUrl(config);
  const client = new McpClient({ name: "kakeratta", url: config.url, headers: config.headers });
  try {
    return await work(async (name, args) => {
      if (!TOOLS.has(name)) throw new Error("Unsupported Kakeratta tool");
      // Cleanup needs a fresh signal after the browser or turn stops.
      const result = await client.callToolRaw(name, args, 20_000, name === "release_ask" ? undefined : signal);
      if (result.isError) throw new KakerattaRejectedError(result.content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n"));
      const value: unknown = result.structuredContent ?? JSON.parse(result.content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Kakeratta response");
      return value as Record<string, unknown>;
    });
  } finally {
    await client.close();
  }
}
