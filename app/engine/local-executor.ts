/**
 * Client-side workflow executor.
 *
 * Runs the same stack-based execution loop as the server executor, but:
 * - Most nodes execute locally in the browser (21/24).
 * - Server-required nodes (mcp, rag-sync, gemihub-command) call POST /api/workflow/execute-node.
 * - Prompt interactions happen directly via callbacks (no SSE round-trip).
 */
import type {
  Workflow,
  WorkflowNode,
  WorkflowNodeType,
  ExecutionContext,
  ExecutionLog,
  ExecutionRecord,
  PromptCallbacks,
} from "./types";
import type { UserSettings } from "~/types/settings";
import { getNextNodes } from "./parser";
import { replaceVariables, parseCondition } from "./handlers/utils";
import {
  handleVariableNode,
  handleSetNode,
  handleIfNode,
  handleWhileNode,
  handleSleepNode,
} from "./handlers/controlFlow";
import { handleJsonNode } from "./handlers/integration";
import { handleHttpNodeLocal } from "./local-handlers/http";
import {
  handleDriveReadNodeLocal,
  handleDriveFileNodeLocal,
  handleDriveSearchNodeLocal,
  handleDriveListNodeLocal,
  handleDriveFolderListNodeLocal,
  handleDriveSaveNodeLocal,
  handleDriveDeleteNodeLocal,
} from "./local-handlers/drive";
import { handlePromptFileNodeLocal, handleDriveFilePickerNodeLocal } from "./local-handlers/prompt";
import { handleWorkflowNodeLocal } from "./local-handlers/workflow";
import { handleCommandNodeLocal } from "./local-handlers/command";
import { handleScriptNodeLocal } from "./local-handlers/script";
import { getCachedApiKey } from "~/services/api-key-cache";

const MAX_WHILE_ITERATIONS = 1000;
const MAX_TOTAL_STEPS = 100000;

/** Node types that still need server API for execution */
const SERVER_NODE_TYPES = new Set<WorkflowNodeType>([
  "mcp", "rag-sync", "gemihub-command",
]);

export interface DriveEvent {
  type: "updated" | "created" | "deleted";
  fileId: string;
  fileName: string;
  content?: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

export interface LocalExecuteOptions {
  workflowId: string;
  workflowName?: string;
  abortSignal?: AbortSignal;
  startNodeId?: string;
  initialVariables?: Record<string, string | number>;
  geminiApiKey?: string;
  settings?: UserSettings;
  subWorkflowDepth?: number;
}

export interface LocalExecuteCallbacks {
  onLog: (log: ExecutionLog) => void;
  onDriveEvent: (event: DriveEvent) => void;
  promptCallbacks: PromptCallbacks;
}

export interface LocalExecuteResult {
  context: ExecutionContext;
  historyRecord: ExecutionRecord;
}

interface ServerNodeResponse {
  variables?: Record<string, string | number>;
  logs?: Array<{
    nodeId: string;
    nodeType: string;
    message: string;
    status: "info" | "success" | "error";
    timestamp: string;
    input?: Record<string, unknown>;
    output?: unknown;
    mcpApps?: unknown[];
  }>;
  driveEvents?: DriveEvent[];
  error?: string;
  needsPrompt?: boolean;
  promptType?: string;
  promptData?: Record<string, unknown>;
  mcpApps?: unknown[];
  usedModel?: string;
}

/**
 * Execute a single server-requiring node by calling the API endpoint.
 * Handles the prompt round-trip pattern automatically.
 */
const MAX_SERVER_PROMPT_RETRIES = 10;

async function executeServerNode(
  node: WorkflowNode,
  context: ExecutionContext,
  workflowId: string,
  callbacks: LocalExecuteCallbacks,
  abortSignal?: AbortSignal,
  promptResponse?: string,
  promptRetryCount = 0,
): Promise<void> {
  const variables: Record<string, string | number> = {};
  for (const [k, v] of context.variables) {
    variables[k] = v;
  }

  const requestBody: Record<string, unknown> = {
    nodeType: node.type,
    nodeId: node.id,
    properties: node.properties,
    variables,
    workflowId,
  };
  if (promptResponse !== undefined) {
    requestBody.promptResponse = promptResponse;
  }

  const res = await fetch("/api/workflow/execute-node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: abortSignal,
  });

  const data: ServerNodeResponse = await res.json();

  // Forward logs and drive events even on error responses
  if (data.logs) {
    for (const log of data.logs) {
      callbacks.onLog({
        nodeId: log.nodeId,
        nodeType: log.nodeType as WorkflowNodeType,
        message: log.message,
        status: log.status,
        timestamp: new Date(log.timestamp),
        input: log.input,
        output: log.output,
        mcpApps: log.mcpApps as ExecutionLog["mcpApps"],
      });
    }
  }
  if (data.driveEvents) {
    for (const event of data.driveEvents) {
      callbacks.onDriveEvent(event);
    }
  }

  if (data.error) {
    throw new Error(data.error);
  }
  if (!res.ok) {
    throw new Error(`Server node execution failed: ${res.status} ${res.statusText}`);
  }

  // Handle prompt-needed response
  if (data.needsPrompt && data.promptType && data.promptData) {
    if (promptRetryCount >= MAX_SERVER_PROMPT_RETRIES) {
      throw new Error("Server prompt retry limit exceeded");
    }
    const userResponse = await handleServerPrompt(
      data.promptType,
      data.promptData,
      callbacks.promptCallbacks,
    );
    if (userResponse === null) {
      throw new Error("User cancelled prompt");
    }
    // Retry the node execution with the prompt response
    await executeServerNode(node, context, workflowId, callbacks, abortSignal, userResponse, promptRetryCount + 1);
    return;
  }

  // Apply variable updates from server
  if (data.variables) {
    // Replace all variables with the server's result
    context.variables.clear();
    for (const [k, v] of Object.entries(data.variables)) {
      context.variables.set(k, v);
    }
  }

}

/**
 * Handle a prompt request from the server by delegating to the client's
 * prompt callbacks directly (no SSE round-trip).
 */
async function handleServerPrompt(
  promptType: string,
  promptData: Record<string, unknown>,
  promptCallbacks: PromptCallbacks,
): Promise<string | null> {
  switch (promptType) {
    case "value":
      return promptCallbacks.promptForValue(
        promptData.title as string || "Input",
        promptData.defaultValue as string | undefined,
        promptData.multiline as boolean | undefined,
      );
    case "dialog": {
      const result = await promptCallbacks.promptForDialog(
        promptData.title as string || "Dialog",
        promptData.message as string || "",
        (promptData.options as string[]) || [],
        promptData.multiSelect === true,
        promptData.button1 as string || "OK",
        promptData.button2 as string | undefined,
        promptData.markdown as boolean | undefined,
        promptData.inputTitle as string | undefined,
        promptData.defaults as { input?: string; selected?: string[] } | undefined,
        promptData.multiline as boolean | undefined,
      );
      return result ? JSON.stringify(result) : null;
    }
    case "drive-file": {
      if (!promptCallbacks.promptForDriveFile) return null;
      const result = await promptCallbacks.promptForDriveFile(
        promptData.title as string || "Select a file",
        promptData.extensions as string[] | undefined,
      );
      return result ? JSON.stringify(result) : null;
    }
    case "diff": {
      if (!promptCallbacks.promptForDiff) return null;
      // The server already computed the diff string in promptData.diff.
      // Pass sentinel values so the callback knows to use the pre-computed diff.
      const diffResult = await promptCallbacks.promptForDiff(
        promptData.title as string || "Confirm",
        promptData.fileName as string || "",
        promptData.diff as string || "",
        "",
      );
      return diffResult ? "OK" : "Cancel";
    }
    case "password": {
      if (!promptCallbacks.promptForPassword) return null;
      return promptCallbacks.promptForPassword(promptData.title as string);
    }
    default:
      return null;
  }
}

/**
 * Execute a workflow locally in the browser.
 * Client-safe nodes run directly; server nodes call the API.
 */
export async function executeWorkflowLocally(
  workflow: Workflow,
  callbacks: LocalExecuteCallbacks,
  options: LocalExecuteOptions,
): Promise<LocalExecuteResult> {
  const context: ExecutionContext = {
    variables: new Map(),
    logs: [],
  };

  if (options.initialVariables) {
    for (const [key, value] of Object.entries(options.initialVariables)) {
      context.variables.set(key, value);
    }
  }

  const historyRecord: ExecutionRecord = {
    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workflowId: options.workflowId,
    workflowName: options.workflowName,
    startTime: new Date().toISOString(),
    status: "running",
    steps: [],
  };

  const startNode = options.startNodeId || workflow.startNode;
  if (!startNode) {
    throw new Error("No workflow nodes found");
  }

  const log = (
    nodeId: string,
    nodeType: WorkflowNode["type"] | "system",
    message: string,
    status: ExecutionLog["status"] = "info",
    input?: Record<string, unknown>,
    output?: unknown,
    mcpApps?: ExecutionLog["mcpApps"],
  ) => {
    const logEntry: ExecutionLog = {
      nodeId, nodeType, message, timestamp: new Date(), status, input, output, mcpApps,
    };
    context.logs.push(logEntry);
    callbacks.onLog(logEntry);
  };

  const buildConditionInput = (conditionRaw?: string) => {
    if (!conditionRaw) return undefined;
    const parsed = parseCondition(conditionRaw);
    if (!parsed) return { condition: conditionRaw };
    const left = replaceVariables(parsed.left, context);
    const right = replaceVariables(parsed.right, context);
    return {
      condition: conditionRaw,
      resolved: `${left} ${parsed.operator} ${right}`,
      left,
      operator: parsed.operator,
      right,
    };
  };

  let currentVarsSnapshot: Record<string, string | number> | undefined;

  const addHistoryStep = (
    nodeId: string,
    nodeType: WorkflowNode["type"],
    input?: Record<string, unknown>,
    output?: unknown,
    status: "success" | "error" | "skipped" = "success",
    error?: string,
  ) => {
    historyRecord.steps.push({
      nodeId, nodeType, timestamp: new Date().toISOString(),
      input, output, status, error,
      variablesSnapshot: currentVarsSnapshot,
    });
  };

  const stack: { nodeId: string; iterationCount: number }[] = [
    { nodeId: startNode, iterationCount: 0 },
  ];
  const whileLoopStates = new Map<string, { iterationCount: number }>();
  let totalIterations = 0;

  while (stack.length > 0 && totalIterations < MAX_TOTAL_STEPS) {
    if (totalIterations > 0 && totalIterations % 100 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (options.abortSignal?.aborted) {
      historyRecord.status = "cancelled";
      historyRecord.endTime = new Date().toISOString();
      return { context, historyRecord };
    }

    totalIterations++;
    const current = stack.pop()!;
    const node = workflow.nodes.get(current.nodeId);
    if (!node) continue;

    currentVarsSnapshot = Object.fromEntries(context.variables);

    log(node.id, node.type, `Executing node: ${node.type}`);

    try {
      switch (node.type) {
        // ── Client-side: Control Flow ──────────────────────────────────
        case "variable": {
          handleVariableNode(node, context);
          const varName = node.properties["name"];
          const varValue = context.variables.get(varName);
          log(node.id, node.type, `Set variable ${varName} = ${varValue}`, "success",
            { name: varName, value: node.properties["value"] }, varValue);
          addHistoryStep(node.id, node.type, { name: varName }, varValue);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "set": {
          await handleSetNode(node, context);
          const setName = node.properties["name"];
          const setValue = context.variables.get(setName);
          log(node.id, node.type, `Updated ${setName} = ${setValue}`, "success",
            { name: setName, expression: node.properties["value"] }, setValue);
          addHistoryStep(node.id, node.type, { name: setName }, setValue);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "if": {
          const ifResult = handleIfNode(node, context);
          const conditionInput = buildConditionInput(node.properties["condition"]);
          log(node.id, node.type, `Condition: ${ifResult}`, "success",
            conditionInput, ifResult);
          addHistoryStep(node.id, node.type, { condition: node.properties["condition"] }, ifResult);
          const next = getNextNodes(workflow, node.id, ifResult);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "while": {
          const whileResult = handleWhileNode(node, context);
          const conditionInput = buildConditionInput(node.properties["condition"]);
          const state = whileLoopStates.get(node.id) || { iterationCount: 0 };

          if (whileResult) {
            state.iterationCount++;
            if (state.iterationCount > MAX_WHILE_ITERATIONS) {
              throw new Error(`While loop exceeded maximum iterations (${MAX_WHILE_ITERATIONS})`);
            }
            whileLoopStates.set(node.id, state);
            const input = conditionInput
              ? { ...conditionInput, iteration: state.iterationCount }
              : { iteration: state.iterationCount };
            log(node.id, node.type, `Loop iteration ${state.iterationCount}`, "info",
              input, whileResult);
            addHistoryStep(node.id, node.type, { iteration: state.iterationCount }, whileResult);
            const next = getNextNodes(workflow, node.id, true);
            for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          } else {
            log(node.id, node.type, `Loop condition false, exiting`, "success", conditionInput);
            addHistoryStep(node.id, node.type, { condition: node.properties["condition"] }, false);
            whileLoopStates.delete(node.id);
            const next = getNextNodes(workflow, node.id, false);
            for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          }
          break;
        }

        case "sleep": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          const duration = replaceVariables(node.properties["duration"] || "0", context);
          log(node.id, node.type, `Sleeping ${duration}ms`, "info");
          await handleSleepNode(node, context, options.abortSignal);
          log(node.id, node.type, `Sleep completed`, "success", { duration });
          addHistoryStep(node.id, node.type, { duration });
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Client-side: Data ──────────────────────────────────────────
        case "json": {
          const jsonSource = node.properties["source"] || "";
          handleJsonNode(node, context);
          const jsonSaveTo = node.properties["saveTo"] || "";
          const jsonOutput = context.variables.get(jsonSaveTo);
          log(node.id, node.type, `JSON parsed`, "success", { source: jsonSource }, jsonOutput);
          addHistoryStep(node.id, node.type, { source: jsonSource }, jsonOutput);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Client-side: Prompts ───────────────────────────────────────
        case "dialog": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          const dialogTitle = replaceVariables(node.properties["title"] || "Dialog", context);
          const dialogMessage = replaceVariables(node.properties["message"] || "", context);
          const optionsStr = replaceVariables(node.properties["options"] || "", context);
          const multiSelect = node.properties["multiSelect"] === "true";
          const markdown = node.properties["markdown"] === "true";
          const button1 = replaceVariables(node.properties["button1"] || "OK", context);
          const button2Prop = node.properties["button2"];
          const button2 = button2Prop ? replaceVariables(button2Prop, context) : undefined;
          const inputTitleProp = node.properties["inputTitle"];
          const inputTitle = inputTitleProp ? replaceVariables(inputTitleProp, context) : undefined;
          const multiline = node.properties["multiline"] === "true";
          const defaultsProp = node.properties["defaults"];
          const dialogSaveTo = node.properties["saveTo"];

          let defaults: { input?: string; selected?: string[] } | undefined;
          if (defaultsProp) {
            try {
              const p = JSON.parse(replaceVariables(defaultsProp, context));
              defaults = { input: p.input, selected: Array.isArray(p.selected) ? p.selected : undefined };
            } catch { /* ignore */ }
          }

          const dialogOptions = optionsStr
            ? optionsStr.split(",").map(o => o.trim()).filter(o => o.length > 0)
            : [];

          log(node.id, node.type, `Showing dialog: ${dialogTitle}`, "info");

          const dialogResult = await callbacks.promptCallbacks.promptForDialog(
            dialogTitle, dialogMessage, dialogOptions, multiSelect,
            button1, button2, markdown, inputTitle, defaults, multiline,
          );

          if (dialogResult === null) throw new Error("Dialog cancelled by user");

          if (dialogSaveTo) {
            context.variables.set(dialogSaveTo, JSON.stringify(dialogResult));
          }

          log(node.id, node.type, `Dialog completed`, "success",
            { title: dialogTitle }, dialogSaveTo ? context.variables.get(dialogSaveTo) : undefined);
          addHistoryStep(node.id, node.type, { title: dialogTitle },
            dialogSaveTo ? context.variables.get(dialogSaveTo) : undefined);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "prompt-value": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          const pvTitle = replaceVariables(node.properties["title"] || "Input", context);
          const pvDefault = node.properties["default"]
            ? replaceVariables(node.properties["default"], context)
            : undefined;
          const pvMultiline = node.properties["multiline"] === "true";
          const pvSaveTo = node.properties["saveTo"];

          if (!pvSaveTo) throw new Error("prompt-value node missing 'saveTo' property");

          log(node.id, node.type, `Prompting: ${pvTitle}`, "info");

          const pvResult = await callbacks.promptCallbacks.promptForValue(pvTitle, pvDefault, pvMultiline);
          if (pvResult === null) throw new Error("Input cancelled by user");

          context.variables.set(pvSaveTo, pvResult);

          log(node.id, node.type, `Input received`, "success",
            { title: pvTitle }, pvResult);
          addHistoryStep(node.id, node.type, { title: pvTitle }, pvResult);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "prompt-selection": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          const psTitle = replaceVariables(node.properties["title"] || "Enter text", context);
          const psSaveTo = node.properties["saveTo"];

          if (!psSaveTo) throw new Error("prompt-selection node missing 'saveTo' property");

          log(node.id, node.type, `Prompt selection: ${psTitle}`, "info");

          const psResult = await callbacks.promptCallbacks.promptForValue(psTitle, "", true);
          if (psResult === null) throw new Error("Input cancelled by user");

          context.variables.set(psSaveTo, psResult);

          log(node.id, node.type, `Selection received`, "success",
            { title: psTitle }, psResult);
          addHistoryStep(node.id, node.type, { title: psTitle }, psResult);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Client-side: HTTP ────────────────────────────────────────────
        case "http": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          const url = replaceVariables(node.properties["url"] || "", context);
          const method = node.properties["method"] || "GET";
          log(node.id, node.type, `HTTP ${method} ${url}`, "info");
          await handleHttpNodeLocal(node, context, options.abortSignal);
          const httpSaveTo = node.properties["saveTo"];
          const httpOutput = httpSaveTo ? context.variables.get(httpSaveTo) : undefined;
          log(node.id, node.type, `HTTP completed`, "success", { url, method }, httpOutput);
          addHistoryStep(node.id, node.type, { url, method }, httpOutput);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Client-side: Command (LLM) ─────────────────────────────────
        case "command": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          // Try in-memory cache as fallback (e.g., sub-workflow where parent had no command nodes)
          const apiKey = options.geminiApiKey || getCachedApiKey();
          if (!apiKey) {
            throw new Error("Gemini API key not available for local execution");
          }
          const cmdPrompt = (node.properties["prompt"] || "").substring(0, 50);
          log(node.id, node.type, `Executing LLM: ${cmdPrompt}...`, "info");
          const cmdResult = await handleCommandNodeLocal(
            node, context, apiKey, options.settings, options.abortSignal,
          );
          // Forward drive events
          for (const event of cmdResult.driveEvents) {
            callbacks.onDriveEvent(event);
          }
          // Log tool calls
          if (cmdResult.toolCalls) {
            for (const tc of cmdResult.toolCalls) {
              log(node.id, node.type, `Tool: ${tc.name}`, "info", tc.args, tc.result);
            }
          }
          if (cmdResult.ragSources && cmdResult.ragSources.length > 0) {
            log(node.id, node.type, `RAG sources: ${cmdResult.ragSources.join(", ")}`, "info");
          }
          if (cmdResult.webSearchSources && cmdResult.webSearchSources.length > 0) {
            log(node.id, node.type, `Web search: ${cmdResult.webSearchSources.join(", ")}`, "info");
          }
          const cmdSaveTo = node.properties["saveTo"];
          const cmdOutput = cmdSaveTo ? context.variables.get(cmdSaveTo) : undefined;
          log(node.id, node.type, `LLM completed`, "success",
            { prompt: node.properties["prompt"], model: cmdResult.usedModel }, cmdOutput,
            cmdResult.mcpApps);
          addHistoryStep(node.id, node.type, { prompt: node.properties["prompt"] }, cmdOutput);
          const nextCmd = getNextNodes(workflow, node.id);
          for (const id of nextCmd.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Client-side: Drive operations ───────────────────────────────
        case "drive-read": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          log(node.id, node.type, `Reading file: ${node.properties["path"] || ""}`, "info");
          await handleDriveReadNodeLocal(node, context, callbacks.promptCallbacks);
          const drSaveTo = node.properties["saveTo"] || "";
          const drContent = context.variables.get(drSaveTo);
          log(node.id, node.type, `File read`, "success",
            { path: node.properties["path"] }, drContent);
          addHistoryStep(node.id, node.type, { path: node.properties["path"] }, drContent);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-file": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          log(node.id, node.type, `Writing file: ${node.properties["path"] || ""}`, "info");
          const dfEvents = await handleDriveFileNodeLocal(node, context, callbacks.promptCallbacks);
          for (const event of dfEvents) callbacks.onDriveEvent(event);
          log(node.id, node.type, `File written: ${node.properties["path"] || ""}`, "success");
          addHistoryStep(node.id, node.type, { path: node.properties["path"] });
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-search": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          log(node.id, node.type, `Searching: ${node.properties["query"] || ""}`, "info");
          await handleDriveSearchNodeLocal(node, context);
          const dsSaveTo = node.properties["saveTo"] || "";
          const dsResults = context.variables.get(dsSaveTo);
          log(node.id, node.type, `Search complete`, "success",
            { query: node.properties["query"] }, dsResults);
          addHistoryStep(node.id, node.type, { query: node.properties["query"] }, dsResults);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-list": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          log(node.id, node.type, `Listing files`, "info");
          await handleDriveListNodeLocal(node, context);
          const dlSaveTo = node.properties["saveTo"] || "";
          const dlResults = context.variables.get(dlSaveTo);
          log(node.id, node.type, `List complete`, "success", undefined, dlResults);
          addHistoryStep(node.id, node.type, undefined, dlResults);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-folder-list": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          log(node.id, node.type, `Listing folders`, "info");
          await handleDriveFolderListNodeLocal(node, context);
          const dflSaveTo = node.properties["saveTo"] || "";
          const dflResults = context.variables.get(dflSaveTo);
          log(node.id, node.type, `Folder list complete`, "success", undefined, dflResults);
          addHistoryStep(node.id, node.type, undefined, dflResults);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-save": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          log(node.id, node.type, `Saving file`, "info");
          const dsEvents = await handleDriveSaveNodeLocal(node, context);
          for (const event of dsEvents) callbacks.onDriveEvent(event);
          log(node.id, node.type, `File saved`, "success");
          addHistoryStep(node.id, node.type);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-delete": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          const deletePath = replaceVariables(node.properties["path"] || "", context);
          log(node.id, node.type, `Deleting file: ${deletePath}`, "info");
          const ddEvents = await handleDriveDeleteNodeLocal(node, context);
          for (const event of ddEvents) callbacks.onDriveEvent(event);
          log(node.id, node.type, `File deleted`, "success");
          addHistoryStep(node.id, node.type);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Client-side: Prompt (file) ──────────────────────────────────
        case "prompt-file": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          log(node.id, node.type, `Prompt file: ${node.properties["title"] || "Select a file"}`, "info");
          await handlePromptFileNodeLocal(node, context, callbacks.promptCallbacks);
          log(node.id, node.type, `File selected`, "success");
          addHistoryStep(node.id, node.type);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-file-picker": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          log(node.id, node.type, `File picker`, "info");
          await handleDriveFilePickerNodeLocal(node, context, callbacks.promptCallbacks);
          log(node.id, node.type, `File selected`, "success");
          addHistoryStep(node.id, node.type);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Client-side: Script (JS sandbox) ──────────────────────────────
        case "script": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          const scriptCode = (node.properties["code"] || "").substring(0, 50);
          log(node.id, node.type, `Executing script: ${scriptCode}...`, "info");
          await handleScriptNodeLocal(node, context, options.abortSignal);
          const scriptSaveTo = node.properties["saveTo"];
          const scriptOutput = scriptSaveTo ? context.variables.get(scriptSaveTo) : undefined;
          log(node.id, node.type, `Script completed`, "success",
            { code: node.properties["code"] }, scriptOutput);
          addHistoryStep(node.id, node.type, { code: node.properties["code"] }, scriptOutput);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Client-side: Sub-workflow ───────────────────────────────────
        case "workflow": {
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");
          const wfPath = replaceVariables(node.properties["path"] || "", context);
          log(node.id, node.type, `Sub-workflow: ${wfPath}`, "info");
          await handleWorkflowNodeLocal(node, context, callbacks, options);
          log(node.id, node.type, `Sub-workflow completed`, "success");
          addHistoryStep(node.id, node.type);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        // ── Server-side nodes (mcp, rag-sync, gemihub-command) ─────────
        default: {
          if (!SERVER_NODE_TYPES.has(node.type)) {
            throw new Error(`Unknown node type: ${node.type}`);
          }
          if (options.abortSignal?.aborted) throw new Error("Execution cancelled");

          // Log node-specific info before server call
          const nodeInfo = getNodeInfoForLog(node, context);
          if (nodeInfo.message) {
            log(node.id, node.type, nodeInfo.message, "info");
          }

          await executeServerNode(node, context, options.workflowId, callbacks, options.abortSignal);

          // Log completion
          const completionInfo = getNodeCompletionLog(node, context);
          log(node.id, node.type, completionInfo.message, "success",
            completionInfo.input, completionInfo.output, completionInfo.mcpApps);
          addHistoryStep(node.id, node.type, completionInfo.input, completionInfo.output);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (options.abortSignal?.aborted || errorMessage === "Execution cancelled") {
        historyRecord.status = "cancelled";
        historyRecord.endTime = new Date().toISOString();
        return { context, historyRecord };
      }
      log(node.id, node.type, `Error: ${errorMessage}`, "error");
      addHistoryStep(node.id, node.type, undefined, undefined, "error", errorMessage);
      historyRecord.status = "error";
      historyRecord.endTime = new Date().toISOString();
      return { context, historyRecord };
    }
  }

  if (totalIterations >= MAX_TOTAL_STEPS) {
    historyRecord.status = "error";
    historyRecord.endTime = new Date().toISOString();
    log("system", "system", `Workflow exceeded maximum steps (${MAX_TOTAL_STEPS})`, "error");
    return { context, historyRecord };
  }

  if (options.abortSignal?.aborted) {
    historyRecord.status = "cancelled";
    historyRecord.endTime = new Date().toISOString();
    return { context, historyRecord };
  }

  historyRecord.status = "completed";
  historyRecord.endTime = new Date().toISOString();

  return { context, historyRecord };
}

/** Build a log message before executing a server node (mcp, rag-sync, gemihub-command) */
function getNodeInfoForLog(
  node: WorkflowNode,
  context: ExecutionContext,
): { message: string } {
  switch (node.type) {
    case "mcp": {
      const url = replaceVariables(node.properties["url"] || "", context);
      const tool = replaceVariables(node.properties["tool"] || "", context);
      return { message: `MCP: ${tool} @ ${url}` };
    }
    case "rag-sync": {
      const path = replaceVariables(node.properties["path"] || "", context);
      return { message: `RAG sync: ${path}` };
    }
    case "gemihub-command": {
      const cmd = replaceVariables(node.properties["command"] || "", context);
      const path = replaceVariables(node.properties["path"] || "", context);
      return { message: `Command: ${cmd} ${path}` };
    }
    default:
      return { message: `Executing: ${node.type}` };
  }
}

/** Build a completion log after a server node executes (mcp, rag-sync, gemihub-command) */
function getNodeCompletionLog(
  node: WorkflowNode,
  context: ExecutionContext,
): { message: string; input?: Record<string, unknown>; output?: unknown; mcpApps?: ExecutionLog["mcpApps"] } {
  switch (node.type) {
    case "mcp": {
      const saveTo = node.properties["saveTo"];
      const result = saveTo ? context.variables.get(saveTo) : undefined;
      return { message: `MCP completed`, output: result };
    }
    case "rag-sync":
      return { message: `RAG sync completed` };
    case "gemihub-command": {
      const cmd = replaceVariables(node.properties["command"] || "", context);
      return { message: `Command completed: ${cmd}` };
    }
    default:
      return { message: `${node.type} completed` };
  }
}
