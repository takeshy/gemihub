import assert from "node:assert/strict";
import test from "node:test";
import { executeMcpTool, getMcpAppResourceUri } from "./mcp-tools.server";
import { McpApprovalRequiredError } from "./mcp-approval.server";
import { McpClient } from "./mcp-client.server";

test("getMcpAppResourceUri accepts current and compatibility metadata", () => {
  assert.equal(getMcpAppResourceUri({ ui: { resourceUri: "ui://demo/current" } }), "ui://demo/current");
  assert.equal(getMcpAppResourceUri({ "ui/resourceUri": "ui://demo/legacy" }), "ui://demo/legacy");
});

test("getMcpAppResourceUri rejects non-ui resources", () => {
  assert.equal(getMcpAppResourceUri({ ui: { resourceUri: "https://example.com/app" } }), undefined);
});

test("chat MCP execution waits for approval when auto-approve is off and the allowlist is empty", async (t) => {
  const callTool = t.mock.method(McpClient.prototype, "callToolWithUi", async () => ({
    content: [{ type: "text", text: "approved result" }],
  }));
  const server = {
    id: "approval_test",
    name: "Approval test",
    url: "https://example.com/approval-test",
    autoApprove: false,
    allowedTools: [],
    tools: [{ name: "read", inputSchema: { type: "object" } }],
  };
  const toolName = "mcp_approval_test_read";
  await assert.rejects(executeMcpTool([server], toolName, {}), McpApprovalRequiredError);
  assert.equal(callTool.mock.callCount(), 0);

  let approve!: () => void;
  const pendingApproval = new Promise<void>((resolve) => { approve = resolve; });
  let prompted = false;
  const execution = executeMcpTool([server], toolName, { path: "example" }, undefined, async (target, tool, args) => {
    assert.equal(target, server);
    assert.equal(tool, "read");
    assert.deepEqual(args, { path: "example" });
    prompted = true;
    await pendingApproval;
  });
  assert.equal(prompted, true);
  assert.equal(callTool.mock.callCount(), 0);
  approve();
  assert.deepEqual(await execution, { textResult: "approved result", mcpApp: undefined });
  assert.equal(callTool.mock.callCount(), 1);
});
