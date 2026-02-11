import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSelectedMcpServerIds, type McpServerConfig } from "./settings";

const baseServers: McpServerConfig[] = [
  {
    id: "alpha_id",
    name: "Alpha",
    url: "https://alpha.example/mcp",
  },
  {
    id: "beta_id",
    name: "Beta",
    url: "https://beta.example/mcp",
  },
];

test("normalizeSelectedMcpServerIds keeps explicit IDs", () => {
  const ids = normalizeSelectedMcpServerIds(["beta_id", "alpha_id"], baseServers);
  assert.deepEqual(ids, ["beta_id", "alpha_id"]);
});

test("normalizeSelectedMcpServerIds maps legacy name when unique", () => {
  const ids = normalizeSelectedMcpServerIds(["Alpha"], baseServers);
  assert.deepEqual(ids, ["alpha_id"]);
});

test("normalizeSelectedMcpServerIds drops legacy name when ambiguous", () => {
  const ambiguousServers: McpServerConfig[] = [
    {
      id: "first_id",
      name: "Duplicate",
      url: "https://first.example/mcp",
    },
    {
      id: "second_id",
      name: "Duplicate",
      url: "https://second.example/mcp",
    },
  ];
  const ids = normalizeSelectedMcpServerIds(["Duplicate"], ambiguousServers);
  assert.deepEqual(ids, []);
});

