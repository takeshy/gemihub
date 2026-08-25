import assert from "node:assert/strict";
import test from "node:test";
import { applyMcpAppCsp, buildMcpAppCsp } from "./mcp-app-csp";
import type { McpAppUiResource } from "~/types/settings";

const resource: McpAppUiResource = {
  uri: "ui://demo/app",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: {
      csp: {
        resourceDomains: ["https://cdn.example.com", "javascript:alert(1)"],
        connect_domains: ["https://api.example.com", "wss://socket.example.com"],
      },
    },
  },
};

test("buildMcpAppCsp allows only declared safe origins", () => {
  const policy = buildMcpAppCsp(resource);
  assert.match(policy, /script-src[^;]*https:\/\/cdn\.example\.com/);
  assert.match(policy, /connect-src https:\/\/api\.example\.com wss:\/\/socket\.example\.com/);
  assert.doesNotMatch(policy, /javascript:/);
  assert.match(policy, /form-action 'none'/);
});

test("applyMcpAppCsp replaces an app-provided policy", () => {
  const html = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>App</title></head><body>ok</body></html>';
  const prepared = applyMcpAppCsp(html, resource);
  assert.equal((prepared.match(/Content-Security-Policy/gi) ?? []).length, 1);
  assert.doesNotMatch(prepared, /default-src \*/);
  assert.match(prepared, /default-src 'none'/);
});
