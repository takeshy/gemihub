import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpNode } from "./mcp";
import type { ExecutionContext, WorkflowNode } from "../types";

test("handleMcpNode propagates serverHeaders into returned MCP app info", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = async (_url, options) => {
    requestCount += 1;
    const bodyText = typeof options?.body === "string" ? options.body : "";
    const body = bodyText ? JSON.parse(bodyText) as { method?: string; id?: number } : {};

    if (body.method === "server/discover") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            supportedVersions: ["2026-07-28"],
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "mock", version: "1.0.0" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (body.method === "tools/call") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [],
            structuredContent: false,
            _meta: { ui: { resourceUri: "ui://resource" } },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (body.method === "resources/read") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            contents: [
              {
                uri: "ui://resource",
                mimeType: "text/html",
                text: "<html><body>ok</body></html>",
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id || 0,
        result: {},
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const node: WorkflowNode = {
    id: "mcp-1",
    type: "mcp",
    properties: {
      url: "https://mcp.example/server",
      tool: "demo_tool",
      headers: "{\"Authorization\":\"Bearer secret-token\"}",
      args: "{\"q\":\"hello\"}",
      saveTo: "toolOutput",
    },
  };

  const context: ExecutionContext = {
    variables: new Map(),
    logs: [],
  };

  try {
    const result = await handleMcpNode(node, context, {
      driveAccessToken: "",
      driveRootFolderId: "",
      driveHistoryFolderId: "",
    });

    assert.equal(context.variables.get("toolOutput"), "false");
    assert.ok(result);
    assert.equal(result?.serverUrl, "https://mcp.example/server");
    assert.deepEqual(result?.serverHeaders, {
      Authorization: "Bearer secret-token",
    });
    assert.equal(requestCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
