import assert from "node:assert/strict";
import test from "node:test";
import {
  getScheduledRequestAudiences,
  resolveScheduledWorkflowPath,
} from "./hubwork.api.workflow.scheduled.tsx";

test("resolveScheduledWorkflowPath resolves canonical GCS paths without traversal", () => {
  const paths = ["daily-report.yaml", "workflows/daily/report.yaml"];
  assert.equal(resolveScheduledWorkflowPath(paths, " workflows/daily/report.yaml "), "workflows/daily/report.yaml");
  assert.equal(resolveScheduledWorkflowPath(paths, "../report.yaml"), null);
  assert.equal(resolveScheduledWorkflowPath(paths, "missing.yaml"), null);
});

test("getScheduledRequestAudiences includes configured audiences and request origin", () => {
  const original = process.env.HUBWORK_SCHEDULER_AUDIENCE;
  process.env.HUBWORK_SCHEDULER_AUDIENCE = "https://gemihub.net, https://gemini-hub.example.run.app";
  try {
    const request = new Request("https://gemini-hub.example.run.app/hubwork/api/workflow/scheduled");

    assert.deepEqual(getScheduledRequestAudiences(request), [
      "https://gemihub.net",
      "https://gemini-hub.example.run.app",
    ]);
  } finally {
    if (original === undefined) {
      delete process.env.HUBWORK_SCHEDULER_AUDIENCE;
    } else {
      process.env.HUBWORK_SCHEDULER_AUDIENCE = original;
    }
  }
});
