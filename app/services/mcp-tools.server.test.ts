import assert from "node:assert/strict";
import test from "node:test";
import { getMcpAppResourceUri } from "./mcp-tools.server";

test("getMcpAppResourceUri accepts current and compatibility metadata", () => {
  assert.equal(getMcpAppResourceUri({ ui: { resourceUri: "ui://demo/current" } }), "ui://demo/current");
  assert.equal(getMcpAppResourceUri({ "ui/resourceUri": "ui://demo/legacy" }), "ui://demo/legacy");
});

test("getMcpAppResourceUri rejects non-ui resources", () => {
  assert.equal(getMcpAppResourceUri({ ui: { resourceUri: "https://example.com/app" } }), undefined);
});
