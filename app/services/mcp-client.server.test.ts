import assert from "node:assert/strict";
import test from "node:test";
import { McpClient, MCP_PROTOCOL_VERSION } from "./mcp-client.server";

interface CapturedRequest {
  httpMethod: string;
  body?: Record<string, unknown>;
  headers: Headers;
}

test("uses a complete stateless 2026-07-28 request envelope", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({
      httpMethod: init?.method || "GET",
      body,
      headers: new Headers(init?.headers),
    });

    let result: unknown;
    if (body.method === "server/discover") {
      result = {
        supportedVersions: [MCP_PROTOCOL_VERSION],
        capabilities: { tools: {} },
        serverInfo: { name: "test", version: "1.0.0" },
      };
    } else if (body.method === "tools/list") {
      result = { tools: [{ name: "echo", inputSchema: { type: "object" } }] };
    } else {
      result = { content: [], structuredContent: false };
    }

    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      headers: {
        "Content-Type": "application/json",
        // Modern clients must ignore session affinity even if a server sends it.
        "Mcp-Session-Id": "ignored-legacy-session",
      },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new McpClient({ id: "test", name: "Test", url: "https://example.com/mcp" });
  await client.listTools();
  const toolResult = await client.callToolWithUi("echo", { value: "hello" });

  assert.equal(toolResult.structuredContent, false);
  assert.deepEqual(
    requests.map((request) => request.body?.method),
    ["server/discover", "tools/list", "tools/call"]
  );
  assert.ok(requests.every((request) => request.httpMethod === "POST"));
  assert.ok(requests.every(
    (request) => request.headers.get("MCP-Protocol-Version") === MCP_PROTOCOL_VERSION
  ));
  assert.ok(requests.every((request) => request.headers.get("Mcp-Session-Id") === null));
  assert.deepEqual(
    requests.map((request) => request.headers.get("Mcp-Method")),
    ["server/discover", "tools/list", "tools/call"]
  );
  assert.equal(requests[2].headers.get("Mcp-Name"), "echo");

  for (const request of requests) {
    const params = request.body?.params as Record<string, unknown>;
    const meta = params._meta as Record<string, unknown>;
    assert.equal(meta["io.modelcontextprotocol/protocolVersion"], MCP_PROTOCOL_VERSION);
    assert.deepEqual(meta["io.modelcontextprotocol/clientInfo"], {
      name: "gemihub",
      version: "1.0.0",
    });
    assert.deepEqual(meta["io.modelcontextprotocol/clientCapabilities"], {});
  }
});

test("falls back to the legacy initialize lifecycle and closes its session", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];

  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    const httpMethod = init?.method || "GET";
    const body = init?.body
      ? JSON.parse(String(init.body)) as Record<string, unknown>
      : undefined;
    requests.push({ httpMethod, body, headers });

    if (httpMethod === "DELETE") return new Response(null, { status: 200 });
    if (body?.method === "server/discover") {
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method not found" },
      });
    }
    if (body?.method === "initialize") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "legacy", version: "1.0.0" },
        },
      }), {
        headers: {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "legacy-session",
        },
      });
    }
    if (body?.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: body?.id,
      result: { tools: [{ name: "legacy_echo", inputSchema: { type: "object" } }] },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new McpClient({ id: "legacy", name: "Legacy", url: "https://example.com/mcp" });
  const tools = await client.listTools();
  await client.close();

  assert.equal(tools[0].name, "legacy_echo");
  assert.deepEqual(
    requests.map((request) => request.body?.method || request.httpMethod),
    ["server/discover", "initialize", "notifications/initialized", "tools/list", "DELETE"]
  );
  assert.equal(requests[1].headers.get("MCP-Protocol-Version"), null);
  for (const request of requests.slice(2)) {
    assert.equal(request.headers.get("Mcp-Session-Id"), "legacy-session");
    assert.equal(request.headers.get("MCP-Protocol-Version"), "2024-11-05");
  }
  const legacyListParams = requests[3].body?.params as Record<string, unknown> | undefined;
  assert.equal(legacyListParams?._meta, undefined);
});

test("does not forward configured headers across an MCP redirect origin", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, headers });
    if (url.startsWith("https://source.example.com")) {
      return new Response(null, { status: 307, headers: { Location: "https://target.example.com/mcp" } });
    }
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    const result = body.method === "server/discover"
      ? { supportedVersions: [MCP_PROTOCOL_VERSION], capabilities: {}, serverInfo: { name: "redirect", version: "1" } }
      : { tools: [] };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new McpClient({ name: "Redirect", url: "https://source.example.com/mcp", headers: { "X-Package": "literal" } });
  await client.listTools();

  assert.equal(requests[0].headers.get("X-Package"), "literal");
  assert.equal(requests[1].headers.get("X-Package"), null);
  assert.equal(requests[1].headers.get("Content-Type"), "application/json");
});
