import assert from "node:assert/strict";
import test from "node:test";
import type { HubworkAccount } from "~/types/hubwork";
import {
  personalVertexBillingForSchedule,
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

test("personalVertexBillingForSchedule bills prepaid runs to the account's uid", () => {
  assert.deepEqual(personalVertexBillingForSchedule({ personalVertexSource: "prepaid" }, "Owner@Example.com "), { uid: "owner@example.com" });
  // "own" (user's own GCP project) is Phase 2 — unsupported for unattended runs.
  assert.equal(personalVertexBillingForSchedule({ personalVertexSource: "own" }, "owner@example.com"), undefined);
  assert.equal(personalVertexBillingForSchedule(undefined, "owner@example.com"), undefined);
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
