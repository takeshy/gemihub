import assert from "node:assert/strict";
import test from "node:test";
import {
  createExecution,
  getExecution,
  requestPrompt,
  stopExecution,
} from "./execution-store.server";

test("requestPrompt returns null immediately when execution already cancelled", async () => {
  const executionId = `exec-test-${Date.now()}-cancelled`;
  createExecution(executionId, "wf-1");
  stopExecution(executionId);

  const result = await requestPrompt(executionId, "value", { title: "Input" });
  assert.equal(result, null);
  assert.equal(getExecution(executionId)?.status, "cancelled");
});

test("stopExecution resolves pending prompt with null", async () => {
  const executionId = `exec-test-${Date.now()}-pending`;
  createExecution(executionId, "wf-2");

  const promptPromise = requestPrompt(executionId, "value", { title: "Input" });
  const stopped = stopExecution(executionId);
  const result = await promptPromise;

  assert.equal(stopped, true);
  assert.equal(result, null);
  assert.equal(getExecution(executionId)?.status, "cancelled");
});
