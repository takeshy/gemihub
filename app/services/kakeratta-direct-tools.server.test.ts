import assert from "node:assert/strict";
import test from "node:test";
import { getDirectTools } from "./kakeratta-direct-tools.server";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";

test("direct MCP actions require both server selection and existing tool approval", async () => {
  let executions = 0;
  const settings = { ...DEFAULT_USER_SETTINGS, mcpServers: [
    { id: "mail", name: "Mail", url: "https://example.com/mail", allowedTools: ["send"] },
    { id: "other", name: "Other", url: "https://example.com/other", autoApprove: true },
  ] };
  const tools = await getDirectTools(settings, ["mail"], {
    async getMcpToolDefinitions(servers) {
      assert.deepEqual(servers.map(s => s.id), ["mail"]);
      servers[0].tools = [{ name: "send" }, { name: "delete" }];
      return ["mcp_mail_send", "mcp_mail_delete"].map(name => ({ name, parameters: { type: "object", properties: {} } }));
    },
    async executeMcpTool(servers, name) {
      assert.equal(servers[0].allowedTools?.[0], "send");
      assert.equal(name, "mcp_mail_send");
      executions++;
      return { textResult: { sent: true } };
    },
  });
  assert.deepEqual(tools.definitions.map(t => t.name), ["mcp_mail_send"]);
  assert.deepEqual(await tools.execute("mcp_mail_send", {}, new AbortController().signal), { sent: true });
  await tools.execute("mcp_mail_delete", {}, new AbortController().signal);
  await tools.execute("mcp_other_send", {}, new AbortController().signal);
  assert.equal(executions, 1);
});

test("OAuth refreshes are persisted during discovery and after direct execution", async () => {
  const settings = { ...DEFAULT_USER_SETTINGS, mcpServers: [{ id: "mail", name: "Mail", url: "https://example.com/mail", autoApprove: true, oauthTokens: { accessToken: "old" } }] };
  const persisted: string[] = [];
  const tools = await getDirectTools(settings, ["mail"], {
    async getMcpToolDefinitions(servers) {
      servers[0].tools = [{ name: "send" }];
      servers[0].oauthTokens = { accessToken: "discovered" };
      return [{ name: "mcp_mail_send", parameters: { type: "object", properties: {} } }];
    },
    async executeMcpTool(servers) {
      servers[0].oauthTokens = { accessToken: "executed" };
      return { textResult: { sent: true } };
    },
  }, async servers => { persisted.push(servers[0].oauthTokens!.accessToken); });
  await tools.execute("mcp_mail_send", {}, new AbortController().signal);
  assert.deepEqual(persisted, ["discovered", "executed"]);
  assert.equal(settings.mcpServers[0].oauthTokens.accessToken, "old", "Cached source settings are not mutated");
});

test("application-only Timeline synchronization is excluded even with auto-approval", async () => {
  const settings = { ...DEFAULT_USER_SETTINGS, mcpServers: [{ id: "kakeratta", name: "Kakeratta", url: "https://example.com/kakeratta", autoApprove: true }] };
  const tools = await getDirectTools(settings, ["kakeratta"], {
    async getMcpToolDefinitions(servers) {
      servers[0].tools = [{ name: "sync_timeline", annotations: { applicationOnlyHint: true } }];
      return [{ name: "mcp_kakeratta_sync_timeline", parameters: { type: "object", properties: {} } }];
    },
    async executeMcpTool() { throw new Error("Model must not invoke synchronization"); },
  });
  assert.equal(tools.definitions.length, 0);
  assert.ok((await tools.execute("mcp_kakeratta_sync_timeline", {}, new AbortController().signal) as { error?: string }).error);
});
