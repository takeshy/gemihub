import { canonicalizeHeaders } from "./mcp-proxy-server-resolver";
import { createHash, randomUUID } from "node:crypto";
import { getFirestore, isFirestoreAvailable } from "./firestore.server";
import type { McpServerConfig } from "~/types/settings";
import type { SessionTokens } from "./session.server";

export type McpApproval = (server: McpServerConfig, tool: string, args: Record<string, unknown>) => Promise<void>;
export class McpApprovalRequiredError extends Error {
  constructor(readonly server: McpServerConfig, readonly tool: string, readonly args: Record<string, unknown>) { super("MCP tool approval required"); }
  response() { return Response.json({ mcpApproval: { server: this.server.name, tool: this.tool, args: this.args } }, { status: 428 }); }
}
export async function requireMcpApproval(server: McpServerConfig, tool: string, args: Record<string, unknown>, approval?: McpApproval) {
  if (server.autoApprove || server.allowedTools?.includes(tool)) return;
  if (!approval) throw new McpApprovalRequiredError(server, tool, args);
  await approval(server, tool, args);
}
export function sameMcpServer(a: McpServerConfig, b: McpServerConfig) {
  return a.url === b.url && (!a.id || !b.id || a.id === b.id) && canonicalizeHeaders(a.headers) === canonicalizeHeaders(b.headers);
}
export function approvalOwner(tokens: SessionTokens): string {
  return createHash("sha256").update(JSON.stringify([tokens.email || tokens.accessToken, tokens.rootFolderId])).digest("hex");
}
type RecordState = { owner: string; expires: number; decision?: string };
const pending = new Map<string, RecordState>();
const collection = () => getFirestore().collection("mcp-tool-approvals");
export async function decideMcpApproval(id: string, owner: string, decision: string): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/.test(id) || !["once", "always", "deny"].includes(decision)) return false;
  if (isFirestoreAvailable()) return getFirestore().runTransaction(async transaction => {
    const ref = collection().doc(id); const snap = await transaction.get(ref); const value = snap.data() as RecordState | undefined;
    if (!value || value.owner !== owner || value.expires < Date.now() || value.decision) return false;
    transaction.update(ref, { decision }); return true;
  });
  const value = pending.get(id);
  if (!value || value.owner !== owner || value.expires < Date.now() || value.decision) return false;
  value.decision = decision; return true;
}
export async function waitForMcpApproval(tokens: SessionTokens, _details: { server: string; tool: string; args: Record<string, unknown> }, emit: (id: string) => void, signal?: AbortSignal): Promise<string> {
  const id = randomUUID(); const value: RecordState = { owner: approvalOwner(tokens), expires: Date.now() + 10 * 60_000 };
  const cloud = isFirestoreAvailable();
  if (cloud) await collection().doc(id).set(value); else pending.set(id, value);
  try {
    emit(id);
    while (Date.now() < value.expires && !signal?.aborted) {
      const record = cloud ? (await collection().doc(id).get()).data() as RecordState | undefined : pending.get(id);
      if (record?.decision) return record.decision;
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    return "deny";
  } finally {
    if (cloud) await collection().doc(id).delete().catch(() => {}); else pending.delete(id);
  }
}
export function explicitMcpApproval(decision: unknown, remember: (server: McpServerConfig, tool: string) => Promise<void>, approvedCall?: { server: string; tool: string; args: Record<string, unknown> }): McpApproval {
  let used = false;
  return async (server, tool, args) => {
    if (used || !approvedCall || approvedCall.server !== server.name || approvedCall.tool !== tool || JSON.stringify(approvedCall.args) !== JSON.stringify(args)) {
      throw new McpApprovalRequiredError(server, tool, args);
    }
    if (decision !== "once" && decision !== "always") {
      if (decision === "deny") throw new Error(`MCP tool call denied: ${tool}`);
      throw new McpApprovalRequiredError(server, tool, args);
    }
    used = true;
    if (decision === "always") await remember(server, tool);
  };
}

export async function rememberMcpTool(accessToken: string, rootFolderId: string, server: McpServerConfig, tool: string): Promise<void> {
  const { getSettings, saveSettings } = await import("./user-settings.server");
  const settings = await getSettings(accessToken, rootFolderId);
  const target = settings.mcpServers.find(item => sameMcpServer(item, server));
  if (!target) throw new Error("MCP server settings changed during approval");
  target.allowedTools = [...new Set([...(target.allowedTools || []), tool])];
  await saveSettings(accessToken, rootFolderId, settings);
  server.allowedTools = target.allowedTools;
}
export function streamMcpApproval(tokens: SessionTokens, send: (chunk: import("~/types/chat").StreamChunk) => void, remember: (server: McpServerConfig, tool: string) => Promise<void>, signal?: AbortSignal): McpApproval {
  return async (server, tool, args) => {
    const decision = await waitForMcpApproval(tokens, { server: server.name, tool, args }, id => send({ type: "mcp_approval", mcpApproval: { id, server: server.name, tool, args } }), signal);
    if (decision === "deny") throw new Error(`MCP tool call denied: ${tool}`);
    if (decision === "always") await remember(server, tool);
  };
}
