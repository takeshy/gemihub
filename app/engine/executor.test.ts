import assert from "node:assert/strict";
import test from "node:test";
import { executeWorkflow } from "./executor";
import type { Workflow, ExecutionLog, ServiceContext } from "./types";

test("executeWorkflow returns cancelled if abort is triggered after last node", async () => {
  const workflow: Workflow = {
    nodes: new Map([
      ["a", { id: "a", type: "variable", properties: { name: "x", value: "1" } }],
    ]),
    edges: [],
    startNode: "a",
  };

  const abortController = new AbortController();
  const serviceContext: ServiceContext = {
    driveAccessToken: "",
    driveRootFolderId: "",
    driveHistoryFolderId: "",
  };

  const onLog = (log: ExecutionLog) => {
    if (log.nodeId === "a" && log.status === "success") {
      abortController.abort();
    }
  };

  const result = await executeWorkflow(
    workflow,
    { variables: new Map() },
    serviceContext,
    onLog,
    { abortSignal: abortController.signal }
  );

  assert.equal(result.historyRecord?.status, "cancelled");
});
