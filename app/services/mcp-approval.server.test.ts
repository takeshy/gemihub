import assert from "node:assert/strict";
import test from "node:test";
import { McpApprovalRequiredError, requireMcpApproval, explicitMcpApproval, sameMcpServer } from "./mcp-approval.server";
import { DRIVE_TOOL_DEFINITIONS, isReadOnlyDriveTool } from "./drive-tool-definitions";

const server = { name: "Example", url: "https://example.com/mcp", headers: { Authorization: "secret" } };
test("MCP defaults to approval, without exposing connection credentials", async () => {
  await assert.rejects(requireMcpApproval(server, "write", { path: "a" }), McpApprovalRequiredError);
  try { await requireMcpApproval(server, "write", { path: "a" }); }
  catch (error) {
    assert.ok(error instanceof McpApprovalRequiredError);
    assert.equal(error.response().status, 428);
    assert.deepEqual(await error.response().json(), { mcpApproval: { server: "Example", tool: "write", args: { path: "a" } } });
  }
});
test("server approval and exact-tool allowlist skip the prompt; revocation restores it", async () => {
  const rejectPrompt = async () => { throw new Error("prompted"); };
  await requireMcpApproval({ ...server, autoApprove: true }, "write", {}, rejectPrompt);
  await requireMcpApproval({ ...server, allowedTools: ["read"] }, "read", {}, rejectPrompt);
  await assert.rejects(requireMcpApproval({ ...server, allowedTools: ["read"] }, "read_all", {}, rejectPrompt), /prompted/);
  await assert.rejects(requireMcpApproval({ ...server, allowedTools: [] }, "read", {}, rejectPrompt), /prompted/);
});
test("allow once is scoped to the reviewed call and consumed once", async () => {
  let saved = 0;
  const approval = explicitMcpApproval("once", async () => { saved++; }, { server: server.name, tool: "write", args: { path: "a" } });
  await assert.rejects(approval(server, "write", { path: "b" }), McpApprovalRequiredError);
  await approval(server, "write", { path: "a" });
  await assert.rejects(approval(server, "write", { path: "a" }), McpApprovalRequiredError);
  assert.equal(saved, 0);
});
test("always waits for persistence; a save failure prevents execution", async () => {
  const approval = explicitMcpApproval("always", async () => { throw new Error("save failed"); }, { server: server.name, tool: "read", args: {} });
  await assert.rejects(approval(server, "read", {}), /save failed/);
});
test("permission identity includes the endpoint and credentials", () => {
  assert.equal(sameMcpServer(server, { ...server, url: "https://other.example/mcp" }), false);
  assert.equal(sameMcpServer(server, { ...server, headers: {} }), false);
});
test("read-only exposes reading, listing and searching and excludes mutations", () => {
  const names = DRIVE_TOOL_DEFINITIONS.filter(tool => isReadOnlyDriveTool(tool.name)).map(tool => tool.name).sort();
  assert.deepEqual(names, ["list_drive_files", "read_drive_file", "search_drive_files"]);
  for (const name of ["create_drive_file", "update_drive_file", "delete_drive_file", "append_timeline"]) assert.equal(isReadOnlyDriveTool(name), false);
  assert.equal(isReadOnlyDriveTool("read_timeline"), true);
});
