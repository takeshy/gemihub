/**
 * Local sub-workflow handler.
 * Resolves and reads workflow files from IndexedDB, then recursively
 * executes using executeWorkflowLocally.
 */
import type { WorkflowNode, ExecutionContext } from "../types";
import { replaceVariables } from "../handlers/utils";
import { readFileLocal, findFileByNameLocal } from "~/services/drive-local";
import { parseWorkflowContentByName } from "../parser";
import { executeWorkflowLocally, type LocalExecuteCallbacks, type LocalExecuteOptions } from "../local-executor";

const MAX_SUB_WORKFLOW_DEPTH = 20;

/**
 * Execute a sub-workflow node locally.
 * Resolves the workflow file from IndexedDB, parses YAML, and
 * recursively calls executeWorkflowLocally.
 */
export async function handleWorkflowNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
  callbacks: LocalExecuteCallbacks,
  options: LocalExecuteOptions,
): Promise<void> {
  const depth = options.subWorkflowDepth ?? 0;
  if (depth >= MAX_SUB_WORKFLOW_DEPTH) {
    throw new Error(`Sub-workflow recursion depth exceeded (max ${MAX_SUB_WORKFLOW_DEPTH})`);
  }

  const path = replaceVariables(node.properties["path"] || "", context);
  const name = node.properties["name"]
    ? replaceVariables(node.properties["name"], context)
    : undefined;
  const inputStr = node.properties["input"] || "";
  const outputStr = node.properties["output"] || "";

  if (!path) throw new Error("Workflow node missing 'path' property");

  // Resolve the workflow file
  const fileId = await resolveWorkflowFileLocal(path);
  const content = await readFileLocal(fileId);
  const subWorkflow = parseWorkflowContentByName(content, name);

  // Parse input variable mapping
  const inputVariables = new Map<string, string | number>();
  if (inputStr) {
    const replacedInput = replaceVariables(inputStr, context);
    try {
      const inputMapping = JSON.parse(replacedInput);
      if (typeof inputMapping === "object" && inputMapping !== null) {
        for (const [key, value] of Object.entries(inputMapping)) {
          if (typeof value === "string" || typeof value === "number") {
            inputVariables.set(key, value);
          } else {
            inputVariables.set(key, JSON.stringify(value));
          }
        }
      }
    } catch {
      const pairs = replacedInput.split(",");
      for (const pair of pairs) {
        const eqIndex = pair.indexOf("=");
        if (eqIndex !== -1) {
          const key = pair.substring(0, eqIndex).trim();
          const value = pair.substring(eqIndex + 1).trim();
          if (key) {
            const contextValue = context.variables.get(value);
            inputVariables.set(key, contextValue !== undefined ? contextValue : value);
          }
        }
      }
    }
  }

  // Execute sub-workflow recursively
  const subResult = await executeWorkflowLocally(
    subWorkflow,
    callbacks,
    {
      ...options,
      startNodeId: undefined,
      workflowId: fileId,
      workflowName: name,
      initialVariables: Object.fromEntries(inputVariables),
      subWorkflowDepth: depth + 1,
    },
  );

  if (subResult.historyRecord?.status === "cancelled") {
    throw new Error("Sub-workflow execution cancelled");
  }
  if (subResult.historyRecord?.status === "error") {
    const subError = subResult.historyRecord.steps
      .filter(s => s.status === "error").pop()?.error;
    throw new Error(subError || "Sub-workflow execution failed");
  }

  const resultVariables = subResult.context.variables;

  // Copy output variables
  if (outputStr) {
    const replacedOutput = replaceVariables(outputStr, context);
    try {
      const outputMapping = JSON.parse(replacedOutput);
      if (typeof outputMapping === "object" && outputMapping !== null) {
        for (const [parentVar, subVar] of Object.entries(outputMapping)) {
          if (typeof subVar === "string") {
            const value = resultVariables.get(subVar);
            if (value !== undefined) context.variables.set(parentVar, value);
          }
        }
      }
    } catch {
      const pairs = replacedOutput.split(",");
      for (const pair of pairs) {
        const eqIndex = pair.indexOf("=");
        if (eqIndex !== -1) {
          const parentVar = pair.substring(0, eqIndex).trim();
          const subVar = pair.substring(eqIndex + 1).trim();
          if (parentVar && subVar) {
            const value = resultVariables.get(subVar);
            if (value !== undefined) context.variables.set(parentVar, value);
          }
        }
      }
    }
  } else {
    const prefix = node.properties["prefix"] || "";
    for (const [key, value] of resultVariables) {
      context.variables.set(prefix + key, value);
    }
  }
}

/**
 * Resolve a workflow file path to a file ID in IndexedDB.
 * Tries the path as-is, then with .yaml and .yml extensions.
 */
async function resolveWorkflowFileLocal(workflowPath: string): Promise<string> {
  const looksLikeWorkflow = workflowPath.endsWith(".yaml") || workflowPath.endsWith(".yml");
  const candidates = looksLikeWorkflow
    ? [workflowPath]
    : [workflowPath, `${workflowPath}.yaml`, `${workflowPath}.yml`];

  for (const candidate of candidates) {
    const file = await findFileByNameLocal(candidate);
    if (file) return file.id;
  }

  throw new Error(`Sub-workflow file not found in local cache: ${workflowPath}`);
}
