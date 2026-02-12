import type {
  Workflow,
  WorkflowNode,
  ExecutionContext,
  ExecutionLog,
  ExecutionRecord,
  WorkflowInput,
  PromptCallbacks,
  ServiceContext,
} from "./types";
import { getNextNodes } from "./parser";
import { replaceVariables, parseCondition } from "./handlers/utils";
import { handleVariableNode, handleSetNode, handleIfNode, handleWhileNode, handleSleepNode } from "./handlers/controlFlow";
import { handleHttpNode } from "./handlers/http";
import { handleDriveFileNode, handleDriveReadNode, handleDriveDeleteNode } from "./handlers/drive";
import { handleDriveSearchNode } from "./handlers/driveSearch";
import { handleDriveListNode, handleDriveFolderListNode } from "./handlers/driveListing";
import { handleDriveSaveNode } from "./handlers/driveSave";
import { handleCommandNode } from "./handlers/command";
import { handlePromptValueNode, handlePromptFileNode, handlePromptSelectionNode, handleDialogNode, handleDriveFilePickerNode } from "./handlers/prompt";
import { handleWorkflowNode, handleJsonNode } from "./handlers/integration";
import { handleMcpNode } from "./handlers/mcp";
import { handleRagSyncNode } from "./handlers/ragSync";
import { handleGemihubCommandNode } from "./handlers/gemihubCommand";

const MAX_WHILE_ITERATIONS = 1000;
const MAX_TOTAL_STEPS = 100000;

export interface ExecuteOptions {
  workflowId?: string;
  workflowName?: string;
  abortSignal?: AbortSignal;
}

export interface ExecuteResult {
  context: ExecutionContext;
  historyRecord?: ExecutionRecord;
}

export async function executeWorkflow(
  workflow: Workflow,
  input: WorkflowInput,
  serviceContext: ServiceContext,
  onLog?: (log: ExecutionLog) => void,
  options?: ExecuteOptions,
  promptCallbacks?: PromptCallbacks
): Promise<ExecuteResult> {
  const context: ExecutionContext = {
    variables: new Map(input.variables),
    logs: [],
  };

  const historyRecord: ExecutionRecord = {
    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workflowId: options?.workflowId || "",
    workflowName: options?.workflowName,
    startTime: new Date().toISOString(),
    status: "running",
    steps: [],
  };

  if (!workflow.startNode) {
    throw new Error("No workflow nodes found");
  }

  const log = (
    nodeId: string,
    nodeType: WorkflowNode["type"],
    message: string,
    status: ExecutionLog["status"] = "info",
    input?: Record<string, unknown>,
    output?: unknown,
    mcpApps?: import("~/types/chat").McpAppInfo[]
  ) => {
    const logEntry: ExecutionLog = {
      nodeId, nodeType, message, timestamp: new Date(), status, input, output, mcpApps,
    };
    context.logs.push(logEntry);
    onLog?.(logEntry);
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

  const addHistoryStep = (
    nodeId: string,
    nodeType: WorkflowNode["type"],
    input?: Record<string, unknown>,
    output?: unknown,
    status: "success" | "error" | "skipped" = "success",
    error?: string
  ) => {
    historyRecord.steps.push({
      nodeId, nodeType, timestamp: new Date().toISOString(),
      input, output, status, error,
    });
  };

  const stack: { nodeId: string; iterationCount: number }[] = [
    { nodeId: workflow.startNode, iterationCount: 0 },
  ];
  const whileLoopStates = new Map<string, { iterationCount: number }>();
  let totalIterations = 0;

  while (stack.length > 0 && totalIterations < MAX_TOTAL_STEPS) {
    if (options?.abortSignal?.aborted) {
      historyRecord.status = "cancelled";
      historyRecord.endTime = new Date().toISOString();
      return { context, historyRecord };
    }

    totalIterations++;
    const current = stack.pop()!;
    const node = workflow.nodes.get(current.nodeId);
    if (!node) continue;

    log(node.id, node.type, `Executing node: ${node.type}`);

    try {
      switch (node.type) {
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

        case "command": {
          const promptPreview = (node.properties["prompt"] || "").substring(0, 50);
          log(node.id, node.type, `Executing LLM: ${promptPreview}...`, "info");
          const cmdResult = await handleCommandNode(node, context, serviceContext, promptCallbacks);
          // Log attachments
          if (cmdResult.attachmentNames && cmdResult.attachmentNames.length > 0) {
            log(node.id, node.type, `Attachments: ${cmdResult.attachmentNames.join(", ")}`, "info");
          }
          // Log tool calls
          if (cmdResult.toolCalls) {
            for (const tc of cmdResult.toolCalls) {
              log(node.id, node.type, `Tool: ${tc.name}`, "info", tc.args, tc.result);
            }
          }
          // Log RAG sources
          if (cmdResult.ragSources && cmdResult.ragSources.length > 0) {
            log(node.id, node.type, `RAG sources: ${cmdResult.ragSources.join(", ")}`, "info");
          }
          // Log web search sources
          if (cmdResult.webSearchSources && cmdResult.webSearchSources.length > 0) {
            log(node.id, node.type, `Web search: ${cmdResult.webSearchSources.join(", ")}`, "info");
          }
          const saveTo = node.properties["saveTo"];
          const output = saveTo ? context.variables.get(saveTo) : undefined;
          log(node.id, node.type, `LLM completed (${cmdResult.usedModel})`, "success",
            { prompt: node.properties["prompt"], model: cmdResult.usedModel }, output, cmdResult.mcpApps);
          addHistoryStep(node.id, node.type, { model: cmdResult.usedModel }, output);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "http": {
          const httpUrl = replaceVariables(node.properties["url"] || "", context);
          const httpMethod = node.properties["method"] || "GET";
          log(node.id, node.type, `HTTP ${httpMethod} ${httpUrl}`, "info");
          await handleHttpNode(node, context, serviceContext);
          const httpSaveTo = node.properties["saveTo"];
          const httpOutput = httpSaveTo ? context.variables.get(httpSaveTo) : undefined;
          log(node.id, node.type, `HTTP completed`, "success", { url: httpUrl, method: httpMethod }, httpOutput);
          addHistoryStep(node.id, node.type, { url: httpUrl, method: httpMethod }, httpOutput);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

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

        case "drive-file": {
          const drivePath = node.properties["path"] || "";
          log(node.id, node.type, `Writing file: ${drivePath}`, "info");
          await handleDriveFileNode(node, context, serviceContext, promptCallbacks);
          log(node.id, node.type, `File written: ${drivePath}`, "success");
          addHistoryStep(node.id, node.type, { path: drivePath });
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-read": {
          const readPath = node.properties["path"] || "";
          log(node.id, node.type, `Reading file: ${readPath}`, "info");
          await handleDriveReadNode(node, context, serviceContext, promptCallbacks);
          const readSaveTo = node.properties["saveTo"] || "";
          const readContent = context.variables.get(readSaveTo);
          log(node.id, node.type, `File read`, "success", { path: readPath }, readContent);
          addHistoryStep(node.id, node.type, { path: readPath }, readContent);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-search": {
          const searchQuery = node.properties["query"] || "";
          log(node.id, node.type, `Searching: ${searchQuery}`, "info");
          await handleDriveSearchNode(node, context, serviceContext);
          const searchSaveTo = node.properties["saveTo"] || "";
          const searchResults = context.variables.get(searchSaveTo);
          log(node.id, node.type, `Search complete`, "success", { query: searchQuery }, searchResults);
          addHistoryStep(node.id, node.type, { query: searchQuery }, searchResults);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-list": {
          log(node.id, node.type, `Listing files`, "info");
          await handleDriveListNode(node, context, serviceContext);
          const listSaveTo = node.properties["saveTo"] || "";
          const listResults = context.variables.get(listSaveTo);
          log(node.id, node.type, `List complete`, "success", {}, listResults);
          addHistoryStep(node.id, node.type, {}, listResults);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-folder-list": {
          log(node.id, node.type, `Listing folders`, "info");
          await handleDriveFolderListNode(node, context, serviceContext);
          const flSaveTo = node.properties["saveTo"] || "";
          const flResults = context.variables.get(flSaveTo);
          log(node.id, node.type, `Folder list complete`, "success", {}, flResults);
          addHistoryStep(node.id, node.type, {}, flResults);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-file-picker": {
          log(node.id, node.type, `File picker`, "info");
          await handleDriveFilePickerNode(node, context, serviceContext, promptCallbacks);
          log(node.id, node.type, `File selected`, "success");
          addHistoryStep(node.id, node.type);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-save": {
          log(node.id, node.type, `Saving file`, "info");
          await handleDriveSaveNode(node, context, serviceContext);
          log(node.id, node.type, `File saved`, "success");
          addHistoryStep(node.id, node.type);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "drive-delete": {
          const deletePath = replaceVariables(node.properties["path"] || "", context);
          log(node.id, node.type, `Deleting file: ${deletePath}`, "info");
          await handleDriveDeleteNode(node, context, serviceContext, promptCallbacks);
          log(node.id, node.type, `File deleted: ${deletePath}`, "success", { path: deletePath });
          addHistoryStep(node.id, node.type, { path: deletePath });
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "dialog": {
          const dialogTitle = node.properties["title"] || "Dialog";
          log(node.id, node.type, `Showing dialog: ${dialogTitle}`, "info");
          await handleDialogNode(node, context, serviceContext, promptCallbacks);
          const dialogSaveTo = node.properties["saveTo"];
          const dialogResult = dialogSaveTo ? context.variables.get(dialogSaveTo) : undefined;
          log(node.id, node.type, `Dialog completed`, "success", { title: dialogTitle }, dialogResult);
          addHistoryStep(node.id, node.type, { title: dialogTitle }, dialogResult);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "prompt-value": {
          const promptTitle = node.properties["title"] || "Input";
          log(node.id, node.type, `Prompting: ${promptTitle}`, "info");
          await handlePromptValueNode(node, context, serviceContext, promptCallbacks);
          const promptSaveTo = node.properties["saveTo"];
          const promptResult = promptSaveTo ? context.variables.get(promptSaveTo) : undefined;
          log(node.id, node.type, `Input received`, "success", { title: promptTitle }, promptResult);
          addHistoryStep(node.id, node.type, { title: promptTitle }, promptResult);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "prompt-file": {
          const pfTitle = node.properties["title"] || "Select a file";
          log(node.id, node.type, `Prompt file: ${pfTitle}`, "info");
          await handlePromptFileNode(node, context, serviceContext, promptCallbacks);
          const pfSaveTo = node.properties["saveTo"];
          const pfResult = pfSaveTo ? context.variables.get(pfSaveTo) : undefined;
          log(node.id, node.type, `File selected`, "success", { title: pfTitle }, pfResult);
          addHistoryStep(node.id, node.type, { title: pfTitle }, pfResult);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "prompt-selection": {
          const psTitle = node.properties["title"] || "Input";
          log(node.id, node.type, `Prompt selection: ${psTitle}`, "info");
          await handlePromptSelectionNode(node, context, serviceContext, promptCallbacks);
          const psSaveTo = node.properties["saveTo"];
          const psResult = psSaveTo ? context.variables.get(psSaveTo) : undefined;
          log(node.id, node.type, `Selection received`, "success", { title: psTitle }, psResult);
          addHistoryStep(node.id, node.type, { title: psTitle }, psResult);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "workflow": {
          const subPath = replaceVariables(node.properties["path"] || "", context);
          log(node.id, node.type, `Sub-workflow: ${subPath}`, "info");
          await handleWorkflowNode(node, context, serviceContext, promptCallbacks);
          log(node.id, node.type, `Sub-workflow completed`, "success", { path: subPath });
          addHistoryStep(node.id, node.type, { path: subPath });
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "mcp": {
          const mcpUrl = replaceVariables(node.properties["url"] || "", context);
          const mcpTool = replaceVariables(node.properties["tool"] || "", context);
          log(node.id, node.type, `MCP: ${mcpTool} @ ${mcpUrl}`, "info");
          const mcpAppInfo = await handleMcpNode(node, context, serviceContext);
          const mcpSaveTo = node.properties["saveTo"];
          const mcpResult = mcpSaveTo ? context.variables.get(mcpSaveTo) : undefined;
          const mcpApps = mcpAppInfo ? [mcpAppInfo] : undefined;
          log(node.id, node.type, `MCP completed`, "success", { url: mcpUrl, tool: mcpTool }, mcpResult, mcpApps);
          addHistoryStep(node.id, node.type, { url: mcpUrl, tool: mcpTool }, mcpResult);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "rag-sync": {
          const ragPath = replaceVariables(node.properties["path"] || "", context);
          const ragSettingName = replaceVariables(node.properties["ragSetting"] || "", context);
          log(node.id, node.type, `RAG sync: ${ragPath} → ${ragSettingName}`, "info");
          await handleRagSyncNode(node, context, serviceContext);
          const ragSaveTo = node.properties["saveTo"];
          const ragResult = ragSaveTo ? context.variables.get(ragSaveTo) : undefined;
          log(node.id, node.type, `RAG sync completed`, "success", { path: ragPath, ragSetting: ragSettingName }, ragResult);
          addHistoryStep(node.id, node.type, { path: ragPath }, ragResult);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "sleep": {
          const duration = replaceVariables(node.properties["duration"] || "0", context);
          log(node.id, node.type, `Sleeping ${duration}ms`, "info");
          await handleSleepNode(node, context, options?.abortSignal);
          log(node.id, node.type, `Sleep completed`, "success", { duration });
          addHistoryStep(node.id, node.type, { duration });
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }

        case "gemihub-command": {
          const ghCmd = replaceVariables(node.properties["command"] || "", context);
          const ghPath = replaceVariables(node.properties["path"] || "", context);
          log(node.id, node.type, `Command: ${ghCmd} ${ghPath}`, "info");
          await handleGemihubCommandNode(node, context, serviceContext);
          const ghSaveTo = node.properties["saveTo"];
          const ghOutput = ghSaveTo ? context.variables.get(ghSaveTo) : undefined;
          log(node.id, node.type, `Command completed: ${ghCmd}`, "success", { command: ghCmd, path: ghPath }, ghOutput);
          addHistoryStep(node.id, node.type, { command: ghCmd, path: ghPath }, ghOutput);
          const next = getNextNodes(workflow, node.id);
          for (const id of next.reverse()) stack.push({ nodeId: id, iterationCount: 0 });
          break;
        }
      }
    } catch (error) {
      if (options?.abortSignal?.aborted) {
        historyRecord.status = "cancelled";
        historyRecord.endTime = new Date().toISOString();
        return { context, historyRecord };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
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
    log("system", "variable", `Workflow exceeded maximum steps (${MAX_TOTAL_STEPS})`, "error");
    return { context, historyRecord };
  }

  if (options?.abortSignal?.aborted) {
    historyRecord.status = "cancelled";
    historyRecord.endTime = new Date().toISOString();
    return { context, historyRecord };
  }

  historyRecord.status = "completed";
  historyRecord.endTime = new Date().toISOString();

  return { context, historyRecord };
}
