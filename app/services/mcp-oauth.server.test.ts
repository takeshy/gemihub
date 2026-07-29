import assert from "node:assert/strict";
import test from "node:test";
import { discoverOAuth, refreshAccessToken } from "./mcp-oauth.server";

test("OAuth discovery preserves the protected resource indicator", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://mcp.example/mcp" && init?.method === "POST") {
      return new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate": "Bearer resource_metadata=\"https://mcp.example/.well-known/oauth-protected-resource\"",
        },
      });
    }
    if (url.endsWith("/.well-known/oauth-protected-resource")) {
      return Response.json({
        resource: "https://mcp.example/mcp",
        authorization_servers: ["https://auth.example"],
      });
    }
    if (url === "https://auth.example/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer: "https://auth.example",
        authorization_endpoint: "https://auth.example/oauth/authorize",
        token_endpoint: "https://auth.example/oauth/token",
        scopes_supported: ["mcp"],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const discovery = await discoverOAuth("https://mcp.example/mcp");

  assert.equal(discovery?.config.resource, "https://mcp.example/mcp");
  assert.deepEqual(discovery?.config.scopes, ["mcp"]);
});

test("refresh sends the discovered resource indicator", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body);
    return Response.json({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await refreshAccessToken({
    clientId: "gemihub",
    authorizationUrl: "https://auth.example/oauth/authorize",
    tokenUrl: "https://auth.example/oauth/token",
    scopes: ["mcp"],
    resource: "https://mcp.example/mcp",
  }, "old-refresh");

  const params = new URLSearchParams(requestBody);
  assert.equal(params.get("resource"), "https://mcp.example/mcp");
});
