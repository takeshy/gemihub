import assert from "node:assert/strict";
import test from "node:test";
import {
  getScheduledRequestAudiences,
  getScheduledWorkflowResolutionError,
  resolveScheduledWorkflowFileId,
} from "./hubwork.api.workflow.scheduled.tsx";

const syncMeta = {
  lastUpdatedAt: "2026-04-03T00:00:00.000Z",
  files: {
    fileA: {
      name: "daily-report.yaml",
      mimeType: "text/plain",
      modifiedTime: "2026-04-03T00:00:00.000Z",
      md5Checksum: "aaa",
    },
    fileB: {
      name: "workflows/daily/report.yaml",
      mimeType: "text/plain",
      modifiedTime: "2026-04-03T00:00:00.000Z",
      md5Checksum: "bbb",
    },
  },
} as const;

test("resolveScheduledWorkflowFileId uses full workflow path", () => {
  assert.equal(resolveScheduledWorkflowFileId(syncMeta, "daily-report.yaml"), "fileA");
  assert.equal(resolveScheduledWorkflowFileId(syncMeta, "workflows/daily/report.yaml"), "fileB");
});

test("resolveScheduledWorkflowFileId rejects invalid paths and reports missing files", () => {
  assert.equal(resolveScheduledWorkflowFileId(syncMeta, "../report.yaml"), null);
  assert.equal(resolveScheduledWorkflowFileId(syncMeta, "missing.yaml"), null);

  assert.equal(getScheduledWorkflowResolutionError(syncMeta, "../report.yaml"), "Invalid workflow path");
  assert.equal(getScheduledWorkflowResolutionError(syncMeta, "missing.yaml"), "File not found");
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
