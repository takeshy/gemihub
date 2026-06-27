import assert from "node:assert/strict";
import test from "node:test";
import { workflowCacheFilePath, WORKFLOW_CACHE_PREFIX } from "./workflow-cache-path.ts";

test("workflow cache files are stored under Dashboards/Data", () => {
  assert.equal(WORKFLOW_CACHE_PREFIX, "Dashboards/Data/");
  assert.equal(
    workflowCacheFilePath("Dashboards/home.dashboard"),
    "Dashboards/Data/Dashboards%2Fhome.dashboard.json",
  );
});
