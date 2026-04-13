import type { McpAppInfo } from "~/types/chat";
import type { SkillWorkflowRef } from "~/types/skill";
import type { DriveEvent, LocalExecuteCallbacks } from "~/engine/local-executor";
import type { ExecutionLog } from "~/engine/types";
import { executeWorkflowLocally } from "~/engine/local-executor";
import { parseWorkflowContentByName } from "~/engine/parser";
import { readFileLocal } from "~/services/drive-local";
import { buildWorkflowToolId } from "~/services/skill-loader";

export interface SkillWorkflowCallbacks {
  onDriveEvent?: (event: DriveEvent) => void;
  onMcpApp?: (app: McpAppInfo) => void;
  onSkillWorkflowStart?: (workflowId: string, workflowName: string) => void;
  onSkillWorkflowEnd?: (workflowId: string, status: string) => void;
  onSkillWorkflowLog?: (log: ExecutionLog) => void;
}

export type SkillWorkflowEntry = {
  skillId: string;
  skillName: string;
  workflow: SkillWorkflowRef;
  folderId: string;
};

export async function executeSkillWorkflowTool(
  workflowId: string,
  variablesJson: string,
  skillWorkflows: SkillWorkflowEntry[],
  callbacks?: SkillWorkflowCallbacks,
): Promise<Record<string, unknown>> {
  const match = skillWorkflows.find(
    (sw) => buildWorkflowToolId(sw.skillId, sw.workflow) === workflowId,
  );
  if (!match) return { error: `Skill workflow not found: ${workflowId}` };

  const fileId = match.workflow.fileId;
  if (!fileId) return { error: `Workflow file not found: ${match.workflow.path}` };

  const content = await readFileLocal(fileId);
  const workflow = parseWorkflowContentByName(content);

  let initialVariables: Record<string, string | number> = {};
  try {
    const parsed = JSON.parse(variablesJson);
    if (typeof parsed === "object" && parsed !== null) initialVariables = parsed;
  } catch {
    // Ignore malformed tool input and run with empty variables.
  }


  const workflowFileName = match.workflow.path.split("/").pop() || match.workflow.name || workflowId;
  callbacks?.onSkillWorkflowStart?.(fileId, workflowFileName);

  const savedFiles: Array<{ fileName: string; action: "created" | "updated" }> = [];
  const executionCallbacks: LocalExecuteCallbacks = {
    onLog: (log) => callbacks?.onSkillWorkflowLog?.(log),
    onDriveEvent: (event) => {
      if (event.type === "created" || event.type === "updated") {
        savedFiles.push({ fileName: event.fileName, action: event.type });
      }
      callbacks?.onDriveEvent?.(event);
    },
    promptCallbacks: {
      promptForValue: async () => null,
      promptForDialog: async () => null,
      promptForDriveFile: async () => null,
    },
  };

  try {
    const result = await executeWorkflowLocally(workflow, executionCallbacks, {
      initialVariables,
      workflowId: fileId,
    });

    const resultVars: Record<string, string | number> = {};
    for (const [k, v] of result.context.variables) resultVars[k] = v;

    const finalStatus = result.historyRecord?.status || "completed";
    callbacks?.onSkillWorkflowEnd?.(fileId, finalStatus);

    // If a node inside the workflow threw, local-executor records status="error"
    // but does NOT rethrow. Surface that as an error-shape result so the chat
    // AI sees a failure and the UI can render the "Open workflow" recovery
    // button. Carries `workflowPath` (the Drive file id) so the UI can open
    // the workflow file without needing a skill-context reverse lookup.
    if (finalStatus === "error") {
      const errorStep = result.historyRecord?.steps?.find((s) => s.status === "error");
      const errorMessage = errorStep?.error || "Workflow execution failed";
      return {
        error: `Workflow execution failed: ${errorMessage}. Do not retry automatically — report the error to the user and ask how to proceed.`,
        workflowId,
        workflowPath: fileId,
        variables: resultVars,
      };
    }

    return {
      status: finalStatus,
      variables: resultVars,
      ...(savedFiles.length > 0 ? { savedFiles } : {}),
    };
  } catch (error) {
    console.error("[skill-workflow] execution failed:", workflowFileName, error);
    callbacks?.onSkillWorkflowEnd?.(fileId, "error");
    // Match llm-hub's contract: return error-shape with workflowPath so the
    // chat UI can offer the "Open workflow" recovery button.
    return {
      error: `Workflow execution failed: ${error instanceof Error ? error.message : String(error)}. Do not retry automatically — report the error to the user and ask how to proceed.`,
      workflowId,
      workflowPath: fileId,
    };
  }
}
