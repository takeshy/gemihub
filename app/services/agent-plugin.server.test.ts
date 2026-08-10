import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PLUGIN_MCP_SCHEMA,
  AGENT_PLUGIN_SCHEMA,
  AgentPluginClientError,
  mergeAgentPluginMcpServers,
  parseAgentPluginManifest,
  parseAgentPluginMcp,
  validateAgentSkill,
  fetchAgentPlugin,
  filterInstallablePackageFiles,
  type AgentPluginPreview,
} from "./agent-plugin.server.ts";

const PINNED_SOURCE = {
  sourceType: "branch" as const,
  sourceRef: "main",
  commitSha: "a".repeat(40),
};

function manifestBytes(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ $schema: AGENT_PLUGIN_SCHEMA, name: "example" }));
}

test("parseAgentPluginManifest accepts v1 and reports non-fatal fields", () => {
  const result = parseAgentPluginManifest(JSON.stringify({
    $schema: AGENT_PLUGIN_SCHEMA,
    name: "example.tools",
    version: "1.0.0",
    unknown: true,
    extensions: "invalid but non-fatal",
  }));
  assert.equal(result.manifest.name, "example.tools");
  assert.equal(result.warnings.length, 2);
});

test("parseAgentPluginManifest rejects fatal schema and name violations", () => {
  assert.throws(() => parseAgentPluginManifest(JSON.stringify({ $schema: AGENT_PLUGIN_SCHEMA, name: "Bad_Name" })), AgentPluginClientError);
  assert.throws(() => parseAgentPluginManifest(JSON.stringify({ $schema: "https://example.com/schema", name: "valid" })), /Unsupported/);
  assert.throws(() => parseAgentPluginManifest(JSON.stringify({ $schema: AGENT_PLUGIN_SCHEMA, name: "valid", author: { extra: true } })), /author/);
});

test("validateAgentSkill enforces Agent Skills metadata and directory match", () => {
  const valid = validateAgentSkill("---\nname: summarize\ndescription: Summarize documents when requested.\n---\n\nInstructions", "summarize");
  assert.equal(valid.name, "summarize");
  assert.throws(() => validateAgentSkill("---\nname: other\ndescription: desc\n---\n", "summarize"), /match its directory/);
  assert.throws(() => validateAgentSkill("---\nname: summarize\n---\n", "summarize"), /description/);
});

test("parseAgentPluginMcp isolates invalid and unsupported entries", () => {
  const result = parseAgentPluginMcp(JSON.stringify({
    $schema: AGENT_PLUGIN_MCP_SCHEMA,
    mcpServers: {
      remote: { type: "streamable-http", url: "https://tools.example.com/mcp", headers: { "X-Tenant": "public" } },
      local: { type: "stdio", command: "node" },
      bad: { type: "streamable-http", url: "http://example.com/mcp" },
    },
  }), "example-plugin");
  assert.equal(result.servers.length, 1);
  assert.equal(result.servers[0].agentPlugin?.serverName, "remote");
  assert.equal(result.warnings.length, 2);
});

test("parseAgentPluginMcp disables an invalid top-level document", () => {
  assert.throws(() => parseAgentPluginMcp(JSON.stringify({ $schema: AGENT_PLUGIN_MCP_SCHEMA, mcpServers: {}, extra: true }), "example"), /top-level schema/);
});

test("parseAgentPluginMcp enforces remote URL and header boundaries", () => {
  const result = parseAgentPluginMcp(JSON.stringify({ $schema: AGENT_PLUGIN_MCP_SCHEMA, mcpServers: {
    loopback: { type: "streamable-http", url: "http://127.20.30.40/mcp" },
    credentials: { type: "streamable-http", url: "https://user@example.com/mcp" },
    fragment: { type: "streamable-http", url: "https://example.com/mcp#secret" },
    duplicateHeaders: { type: "streamable-http", url: "https://example.com/mcp", headers: { Authorization: "a", authorization: "b" } },
  } }), "example");
  assert.equal(result.servers.length, 1);
  assert.equal(result.servers[0].agentPlugin?.serverName, "loopback");
  assert.equal(result.warnings.length, 3);
});

test("fetchAgentPlugin rejects repository path components", async () => {
  await assert.rejects(() => fetchAgentPlugin("../repo", { source: PINNED_SOURCE }), AgentPluginClientError);
  await assert.rejects(() => fetchAgentPlugin("owner/..", { source: PINNED_SOURCE }), AgentPluginClientError);
});

test("mergeAgentPluginMcpServers preserves client-managed OAuth and tools", () => {
  const preview = {
    manifest: { $schema: AGENT_PLUGIN_SCHEMA, name: "example" },
    mcpServers: [{ id: "new", name: "example: api", url: "https://new.example.com/mcp", agentPlugin: { pluginName: "example", serverName: "api" } }],
  } as AgentPluginPreview;
  const result = mergeAgentPluginMcpServers([
    { id: "manual", name: "Manual", url: "https://manual.example.com/mcp" },
    { id: "old", name: "example: api", url: "https://old.example.com/mcp", tools: [{ name: "tool" }], oauth: { clientId: "id", authorizationUrl: "https://auth.example.com", tokenUrl: "https://token.example.com", scopes: [] }, agentPlugin: { pluginName: "example", serverName: "api" } },
  ], preview);
  assert.equal(result.length, 2);
  assert.equal(result[1].url, "https://new.example.com/mcp");
  assert.equal(result[1].oauth?.clientId, "id");
  assert.equal(result[1].tools?.[0].name, "tool");
});

test("fetchAgentPlugin uses a pinned SHA and preview downloads only component metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); urls.push(url);
    if (url.includes("/git/trees/")) return Response.json({ tree: [
      { path: "plugin.json", type: "blob", mode: "100644", size: 100 },
      { path: "skills/greet/SKILL.md", type: "blob", mode: "100644", size: 100 },
      { path: "assets/large.bin", type: "blob", mode: "100644", size: 100 },
    ] });
    if (url.endsWith("/plugin.json")) return new Response(manifestBytes());
    if (url.endsWith("/skills/greet/SKILL.md")) return new Response("---\nname: greet\ndescription: Greet users.\n---\n");
    throw new Error(`Unexpected URL: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await fetchAgentPlugin("owner/repo", { source: PINNED_SOURCE, includeAllFiles: false });
  assert.equal(result.commitSha, PINNED_SOURCE.commitSha);
  assert.equal(result.skills.length, 1);
  assert.ok(urls.every((url) => !url.includes("/releases/") && !url.includes("/commits/")));
  assert.ok(urls.every((url) => !url.endsWith("assets/large.bin")));
});

test("fetchAgentPlugin limits raw file download concurrency", async (t) => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let peak = 0;
  const extras = Array.from({ length: 24 }, (_, index) => ({ path: `assets/${index}.txt`, type: "blob", mode: "100644", size: 1 }));
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/git/trees/")) return Response.json({ tree: [{ path: "plugin.json", type: "blob", mode: "100644", size: 100 }, ...extras] });
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return url.endsWith("/plugin.json") ? new Response(manifestBytes()) : new Response("x");
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await fetchAgentPlugin("owner/repo", { source: PINNED_SOURCE });
  assert.ok(peak <= 10, `peak concurrency was ${peak}`);
  assert.ok(peak > 1);
});

test("fetchAgentPlugin reports non-UTF-8 plugin.json as a client error", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/git/trees/")
    ? Response.json({ tree: [{ path: "plugin.json", type: "blob", mode: "100644", size: 1 }] })
    : new Response(new Uint8Array([0xff]));
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(() => fetchAgentPlugin("owner/repo", { source: PINNED_SOURCE }), (error) => error instanceof AgentPluginClientError && /UTF-8/.test(error.message));
});

test("invalid skill subtrees are excluded from the installed package", () => {
  const bytes = new Uint8Array([1]);
  const files = filterInstallablePackageFiles({
    skills: [{ name: "valid", description: "ok", path: "skills/valid/SKILL.md" }],
    files: [
      { path: "plugin.json", bytes },
      { path: "skills/valid/SKILL.md", bytes },
      { path: "skills/valid/references/help.md", bytes },
      { path: "skills/Invalid/SKILL.md", bytes },
      { path: "skills/Invalid/assets/data.txt", bytes },
    ],
  });
  assert.deepEqual(files.map((file) => file.path), [
    "plugin.json",
    "skills/valid/SKILL.md",
    "skills/valid/references/help.md",
  ]);
});

test("GitHub rate limit failures explain the optional server token", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("rate limited", {
    status: 403,
    headers: { "X-RateLimit-Reset": "2000000000" },
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(
    () => fetchAgentPlugin("owner/repo", { includeAllFiles: false }),
    (error) => error instanceof AgentPluginClientError && /AGENT_PLUGINS_GITHUB_TOKEN/.test(error.message)
  );
});
