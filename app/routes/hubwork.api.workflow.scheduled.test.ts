import assert from "node:assert/strict";
import test from "node:test";
import type { HubworkAccount } from "~/types/hubwork";
import {
  personalVertexRunForSchedule,
  selectScheduledAccounts,
} from "~/services/hubwork-scheduled.server";
import {
  getScheduledRequestAudiences,
  resolveScheduledWorkflowPath,
} from "./hubwork.api.workflow.scheduled.tsx";

function accountWithPlan(plan: string): HubworkAccount {
  return { id: plan, email: "owner@example.com", plan } as unknown as HubworkAccount;
}

test("selectScheduledAccounts includes pro and business/granted, excludes lite", () => {
  const selected = selectScheduledAccounts(
    ["pro", "business", "granted", "lite"].map(accountWithPlan),
  );
  assert.deepEqual(
    selected.map((account) => account.plan),
    ["pro", "business", "granted"],
  );
});

test("personalVertexRunForSchedule bills prepaid runs to the account's uid", () => {
  const run = personalVertexRunForSchedule({ usePersonalVertex: true, personalVertexSource: "prepaid" }, "Owner@Example.com ");
  assert.deepEqual(run?.billing, { uid: "owner@example.com", scope: "personal" });
  assert.equal(run?.tenant.vertexOAuthUserId, undefined);
});

test("personalVertexRunForSchedule runs the own-project source on the user's connection without billing", () => {
  const run = personalVertexRunForSchedule(
    { usePersonalVertex: true, personalVertexSource: "own", personalVertexProjectId: "my-proj", personalVertexLocation: "asia-northeast1" },
    "owner@example.com",
  );
  assert.equal(run?.billing, undefined);
  assert.equal(run?.tenant.vertexProjectId, "my-proj");
  assert.equal(run?.tenant.vertexLocation, "asia-northeast1");
  assert.equal(run?.tenant.vertexOAuthUserId, "owner@example.com");
  assert.equal(run?.tenant.vertexBillingMode, "customer");
});

test("personalVertexRunForSchedule is undefined unless Vertex AI is selected", () => {
  assert.equal(personalVertexRunForSchedule({ usePersonalVertex: false, personalVertexSource: "prepaid" }, "owner@example.com"), undefined);
  assert.equal(personalVertexRunForSchedule(undefined, "owner@example.com"), undefined);
  assert.throws(() => personalVertexRunForSchedule({ usePersonalVertex: true, personalVertexSource: "own" }, "owner@example.com"));
});

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
