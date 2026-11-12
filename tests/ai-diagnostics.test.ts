import { test } from "node:test";
import assert from "node:assert/strict";
import { observedAiCall } from "../server/ai-diagnostics.ts";

test("AI diagnostics retain the stage, elapsed outcome and correlation without request or error payloads", async () => {
  const events: unknown[] = [];
  const call = { provider: "vertex", model: "test-model", stage: "identify", timeoutMs: 180000, prompt: "private request", token: "secret" };
  const error = Object.assign(new Error("private provider response"), { status: 504 });
  await assert.rejects(observedAiCall(call, async () => { throw error; }, async event => { events.push(event); }), error);
  const [started, failed] = events as { id: string; state: string; stage: string; durationMs?: number; status?: number }[];
  assert.equal(started.id, failed.id);
  assert.equal(started.stage, "identify");
  assert.equal(started.state, "started");
  assert.equal(failed.state, "failed");
  assert.equal(failed.status, 504);
  assert.ok(failed.durationMs! >= 0);
  assert.doesNotMatch(JSON.stringify(events), /private|secret|prompt|token|provider response/);
});

test("unavailable diagnostic storage preserves successful results and the original model error", async () => {
  const call = { provider: "vertex", model: "test", stage: "review" };
  const unavailable = async () => { throw new Error("disk unavailable"); };
  assert.equal(await observedAiCall(call, async () => "result", unavailable), "result");
  const error = new Error("model failed");
  await assert.rejects(observedAiCall(call, async () => { throw error; }, unavailable), error);
});
