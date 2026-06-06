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

test("executeWorkflow skips prompt-value when input variable is already provided", async () => {
  const workflow: Workflow = {
    nodes: new Map([
      ["ask", { id: "ask", type: "prompt-value", properties: { title: "Text", saveTo: "text" } }],
    ]),
    edges: [],
    startNode: "ask",
  };
  const serviceContext: ServiceContext = {
    driveAccessToken: "",
    driveRootFolderId: "",
    driveHistoryFolderId: "",
  };

  const result = await executeWorkflow(
    workflow,
    { variables: new Map([["text", "hello"]]) },
    serviceContext,
  );

  assert.equal(result.historyRecord?.status, "completed");
  assert.equal(result.context.variables.get("text"), "hello");
});

test("executeWorkflow uses prompt-value default without prompt callback", async () => {
  const workflow: Workflow = {
    nodes: new Map([
      ["ask", { id: "ask", type: "prompt-value", properties: { title: "Text", default: "{{inputText}}", saveTo: "text" } }],
    ]),
    edges: [],
    startNode: "ask",
  };
  const serviceContext: ServiceContext = {
    driveAccessToken: "",
    driveRootFolderId: "",
    driveHistoryFolderId: "",
  };

  const result = await executeWorkflow(
    workflow,
    { variables: new Map([["inputText", "Lo siento mucho."]]) },
    serviceContext,
  );

  assert.equal(result.historyRecord?.status, "completed");
  assert.equal(result.context.variables.get("text"), "Lo siento mucho.");
});

test("executeWorkflow prompts when prompt-value target is only an empty input declaration", async () => {
  const workflow: Workflow = {
    nodes: new Map([
      ["declare", { id: "declare", type: "variable", properties: { name: "text" } }],
      ["ask", { id: "ask", type: "prompt-value", properties: { title: "Text", saveTo: "text" } }],
    ]),
    edges: [{ from: "declare", to: "ask" }],
    startNode: "declare",
  };
  const serviceContext: ServiceContext = {
    driveAccessToken: "",
    driveRootFolderId: "",
    driveHistoryFolderId: "",
  };

  const result = await executeWorkflow(
    workflow,
    { variables: new Map() },
    serviceContext,
    undefined,
    undefined,
    {
      promptForValue: async () => "typed text",
      promptForDialog: async () => null,
      promptForDriveFile: async () => null,
    },
  );

  assert.equal(result.historyRecord?.status, "completed");
  assert.equal(result.context.variables.get("text"), "typed text");
});
