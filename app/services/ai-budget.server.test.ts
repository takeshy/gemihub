import assert from "node:assert/strict";
import test from "node:test";
import { currentAiUsageMonth, estimateVertexCostUsd } from "./ai-budget.server.ts";

test("currentAiUsageMonth uses a stable UTC calendar month", () => {
  assert.equal(currentAiUsageMonth(new Date("2026-08-31T23:59:59Z")), "2026-08");
  assert.equal(currentAiUsageMonth(new Date("2026-09-01T00:00:00Z")), "2026-09");
});

test("estimateVertexCostUsd prices input and output/thinking separately", () => {
  assert.equal(
    estimateVertexCostUsd("gemini-3.7-flash", {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      thinkingTokens: 500_000,
    }),
    3.5,
  );
});

test("unknown models use a conservative non-zero price", () => {
  assert.equal(
    estimateVertexCostUsd("future-model", { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    14,
  );
});
