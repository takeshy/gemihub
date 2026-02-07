import type { WorkflowNode, ExecutionContext, ServiceContext, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";

// Handle workflow node - execute a sub-workflow
export async function handleWorkflowNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _serviceContext: ServiceContext,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const path = replaceVariables(node.properties["path"] || "", context);
  const name = node.properties["name"]
    ? replaceVariables(node.properties["name"], context)
    : undefined;
  const inputStr = node.properties["input"] || "";
  const outputStr = node.properties["output"] || "";

  if (!path) throw new Error("Workflow node missing 'path' property");

  if (!promptCallbacks?.executeSubWorkflow) {
    throw new Error("Sub-workflow execution not available");
  }

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

  const resultVariables = await promptCallbacks.executeSubWorkflow(path, name, inputVariables);

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

// Handle JSON parse node
export function handleJsonNode(
  node: WorkflowNode,
  context: ExecutionContext
): void {
  const sourceRaw = node.properties["source"];
  const saveTo = node.properties["saveTo"];

  if (!sourceRaw) throw new Error("JSON node missing 'source' property");
  if (!saveTo) throw new Error("JSON node missing 'saveTo' property");

  // Resolve {{variable}} templates in source
  const resolved = replaceVariables(sourceRaw, context);

  // Try variable lookup first (backward compat for `source: myVar`), then use resolved string directly
  const sourceValue = context.variables.get(resolved) ?? resolved;

  let jsonString = String(sourceValue);

  // Extract JSON from markdown code block if present
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonString = codeBlockMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonString);
    context.variables.set(saveTo, JSON.stringify(parsed));
  } catch (e) {
    throw new Error(`Failed to parse JSON from '${sourceRaw}': ${e instanceof Error ? e.message : String(e)}`);
  }
}
