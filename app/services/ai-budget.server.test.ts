import assert from "node:assert/strict";
import test from "node:test";
import { currentAiUsageMonth, estimateVertexCostUsd } from "./ai-budget.server.ts";
import { MODEL_PRICING, SEARCH_GROUNDING_COST } from "./ai/models.ts";

test("currentAiUsageMonth uses a stable UTC calendar month", () => {
  assert.equal(currentAiUsageMonth(new Date("2026-08-31T23:59:59Z")), "2026-08");
  assert.equal(currentAiUsageMonth(new Date("2026-09-01T00:00:00Z")), "2026-09");
});

test("estimateVertexCostUsd prices input and output/thinking separately", () => {
  // Flash is $1.50/M in, $7.50/M out — the published table in ai/models.ts.
  assert.equal(
    estimateVertexCostUsd("gemini-3.7-flash", {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      thinkingTokens: 500_000,
    }),
    9,
  );
});

test("estimateVertexCostUsd matches the published per-token table", () => {
  // A budget priced below what Google charges is money we never bill for, so
  // every model the registry publishes must round-trip exactly.
  for (const [model, price] of Object.entries(MODEL_PRICING)) {
    assert.equal(
      estimateVertexCostUsd(model, { inputTokens: 1_000_000 }),
      price.input * 1_000_000,
      `${model} input`,
    );
    assert.equal(
      estimateVertexCostUsd(model, { outputTokens: 1_000_000 }),
      price.output * 1_000_000,
      `${model} output`,
    );
  }
});

test("estimateVertexCostUsd bills Google Search grounding per prompt", () => {
  assert.equal(
    estimateVertexCostUsd("gemini-3.7-flash", undefined, { searchGroundingRequests: 3 }),
    3 * SEARCH_GROUNDING_COST["gemini-3.7-flash"],
  );
  // Grounding is charged on top of tokens, not instead of them.
  assert.equal(
    estimateVertexCostUsd(
      "gemini-3.7-flash",
      { inputTokens: 1_000_000 },
      { searchGroundingRequests: 1 },
    ),
    1.5 + SEARCH_GROUNDING_COST["gemini-3.7-flash"],
  );
});

test("grounding requests are ignored when absent or nonsensical", () => {
  assert.equal(estimateVertexCostUsd("gemini-3.7-flash", undefined), 0);
  assert.equal(
    estimateVertexCostUsd("gemini-3.7-flash", undefined, { searchGroundingRequests: -5 }),
    0,
  );
});

test("unknown models use a conservative non-zero price", () => {
  assert.equal(
    estimateVertexCostUsd("future-model", { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    14,
  );
});
