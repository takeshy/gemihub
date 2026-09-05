import assert from "node:assert/strict";
import test from "node:test";
import { createMcpAppBridge, type McpAppHostMessage } from "./mcp-app-bridge";
import type { McpAppResult } from "~/types/settings";

function setup() {
  const sent: McpAppHostMessage[] = [];
  const calls: unknown[] = [];
  const heights: number[] = [];
  const toolResult: McpAppResult = {
    content: [{ type: "text", text: "Map ready" }],
    structuredContent: { candidates: [{ name: "Tokyo" }] },
    _meta: { ui: { resourceUri: "ui://map" } },
  };
  const handle = createMcpAppBridge({
    send: message => sent.push(message),
    toolInput: { destination: "Tokyo" },
    toolResult,
    hostContext: () => ({ theme: "dark", locale: "ja", displayMode: "inline" }),
    callTool: async (name, args) => { calls.push({ name, args }); return toolResult; },
    readResource: async uri => ({ uri, mimeType: "text/plain", text: "Resource content" }),
    resize: height => heights.push(height),
  });
  return { handle, sent, calls, heights, toolResult };
}

test("standard MCP App handshake delivers input and complete result only after readiness", async () => {
  const { handle, sent, toolResult } = setup();
  await handle({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  assert.deepEqual(sent, []);
  await handle({ jsonrpc: "2.0", id: 0, method: "ui/initialize", params: {
    protocolVersion: "2026-01-26", appInfo: { name: "Map", version: "1" }, appCapabilities: {},
  } });
  assert.deepEqual(sent, [{ jsonrpc: "2.0", id: 0, result: {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "GemiHub", version: "1.0.0" },
    hostCapabilities: { serverTools: {}, serverResources: {} },
    hostContext: { theme: "dark", locale: "ja", displayMode: "inline" },
  } }]);
  await handle({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  assert.deepEqual(sent.slice(1), [
    { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { destination: "Tokyo" } } },
    { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: toolResult },
  ]);
  await handle({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  assert.equal(sent.length, 3);
});

test("notifications never receive JSON-RPC error replies or execute tools", async () => {
  const { handle, sent, calls, heights } = setup();
  for (const method of ["notifications/message", "notifications/cancelled", "unknown", "tools/call"]) {
    await handle({ jsonrpc: "2.0", method, params: { name: "write" } });
  }
  await handle({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 600 } });
  await handle({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: Infinity } });
  assert.deepEqual(sent, []);
  assert.deepEqual(calls, []);
  assert.deepEqual(heights, [600]);
});

test("tool calls and resource reads use the provided server proxies", async () => {
  const { handle, sent, calls, toolResult } = setup();
  await handle({ jsonrpc: "2.0", id: "tool", method: "tools/call", params: { name: "details", arguments: { id: 1 } } });
  assert.deepEqual(calls, [{ name: "details", args: { id: 1 } }]);
  assert.deepEqual(sent[0], { jsonrpc: "2.0", id: "tool", result: toolResult });
  await handle({ jsonrpc: "2.0", id: "resource", method: "resources/read", params: { uri: "ui://details" } });
  assert.deepEqual(sent[1], { jsonrpc: "2.0", id: "resource", result: {
    contents: [{ uri: "ui://details", mimeType: "text/plain", text: "Resource content" }],
  } });
});

test("malformed tool arguments are rejected before reaching the proxy", async () => {
  const { handle, sent, calls } = setup();
  await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "write", arguments: "invalid" } });
  assert.equal(sent[0].error?.code, -32602);
  assert.deepEqual(calls, []);
});

test("a denied approval is returned to the app as an error", async () => {
  const sent: McpAppHostMessage[] = [];
  const handle = createMcpAppBridge({
    send: message => sent.push(message),
    toolResult: { content: [] },
    hostContext: () => ({}),
    callTool: async () => { throw new Error("MCP tool call denied: write"); },
    readResource: async () => null,
    resize: () => {},
  });
  await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "write" } });
  assert.deepEqual(sent, [{ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "MCP tool call denied: write" } }]);
});

test("unknown requests receive method-not-found while ping is supported", async () => {
  const { handle, sent } = setup();
  await handle({ jsonrpc: "2.0", id: 1, method: "ping" });
  await handle({ jsonrpc: "2.0", id: 2, method: "unknown" });
  assert.deepEqual(sent[0], { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(sent[1].error?.code, -32601);
});
