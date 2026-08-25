import assert from "node:assert/strict";
import test from "node:test";
import { buildInteractionsTools } from "./gemini-interactions.server";
import type { ToolDefinition } from "~/types/settings";

const functionTool: ToolDefinition = {
  name: "read_document",
  description: "Read a document",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

test("Google Search is exclusive in Interactions API requests", () => {
  const tools = buildInteractionsTools(
    [functionTool],
    true,
    "gemini-3.7-flash",
  );

  assert.deepEqual(tools, [{ type: "google_search" }]);
});

test("function tools remain enabled without Google Search", () => {
  const tools = buildInteractionsTools(
    [functionTool],
    false,
    "gemini-3.7-flash",
  );

  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.type, "function");
});
