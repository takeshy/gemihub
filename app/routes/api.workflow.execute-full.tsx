import type { Route } from "./+types/api.workflow.execute-full";
import { z } from "zod";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getDriveContext } from "~/services/google-drive.server";
import { getSettings } from "~/services/user-settings.server";
import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflow } from "~/engine/executor";
import type { WorkflowInput, ServiceContext, ExecutionLog } from "~/engine/types";
import { google } from "googleapis";
import { getAccountByRootFolderId } from "~/services/hubwork-accounts.server";

const MAX_WORKFLOW_YAML_SIZE = 512 * 1024; // 512KB

const ExecuteFullSchema = z.object({
  workflowYaml: z.string().min(1).max(MAX_WORKFLOW_YAML_SIZE),
  workflowName: z.string().max(256).optional(),
  variables: z.record(z.string(), z.string().or(z.number())).optional(),
});

/**
 * Full server-side workflow execution via SSE.
 * Requires a Hubwork account (Firestore).
 */
export async function action({ request }: Route.ActionArgs) {
  const sessionTokens = await requireAuth(request);
  const { tokens } = await getValidTokens(request, sessionTokens);

  const { hasProFeatures } = await import("~/types/hubwork");
  const hubworkAccount = await getAccountByRootFolderId(tokens.rootFolderId);
  if (!hubworkAccount || !hasProFeatures(hubworkAccount)) {
    throw new Response("Hubwork Pro subscription required", { status: 403 });
  }

  const settings = await getSettings(tokens.accessToken, tokens.rootFolderId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Response("Invalid JSON body", { status: 400 });
  }
  const parsed = ExecuteFullSchema.safeParse(body);
  if (!parsed.success) {
    throw new Response(`Invalid request: ${parsed.error.issues.map(i => i.message).join(", ")}`, { status: 400 });
  }
  const { workflowYaml, workflowName, variables: inputVars } = parsed.data;

  const workflow = parseWorkflowYaml(workflowYaml);
  const variablesMap = new Map<string, string | number>(
    Object.entries(inputVars || {})
  );
  const input: WorkflowInput = { variables: variablesMap };

  const driveContext = await getDriveContext(tokens);
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokens.accessToken });

  const serviceContext: ServiceContext = {
    driveAccessToken: tokens.accessToken,
    driveRootFolderId: tokens.rootFolderId,
    driveHistoryFolderId: driveContext.historyFolderId,
    geminiApiKey: tokens.geminiApiKey,
    abortSignal: abortController.signal,
    settings,
  };

  // Add hubwork clients if configured
  const hubworkSpreadsheetId = settings?.hubwork?.spreadsheets?.[0]?.id || settings?.hubwork?.spreadsheetId;
  if (hubworkSpreadsheetId) {
    serviceContext.hubworkSheetsClient = google.sheets({ version: "v4", auth: oauth2Client });
    serviceContext.hubworkSpreadsheetId = hubworkSpreadsheetId;
  }
  serviceContext.hubworkGmailClient = google.gmail({ version: "v1", auth: oauth2Client });
  serviceContext.hubworkCalendarClient = google.calendar({ version: "v3", auth: oauth2Client });

  // SSE streaming
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const onLog = (log: ExecutionLog) => {
        send("log", {
          nodeId: log.nodeId,
          nodeType: log.nodeType,
          message: log.message,
          status: log.status,
          timestamp: log.timestamp.toISOString(),
        });
      };

      try {
        const result = await executeWorkflow(workflow, input, serviceContext, onLog, {
          workflowName,
          abortSignal: abortController.signal,
        });

        const finalVars: Record<string, string | number> = {};
        for (const [k, v] of result.context.variables) {
          finalVars[k] = v;
        }

        send("result", {
          status: result.historyRecord?.status || "completed",
          variables: finalVars,
          historyRecord: result.historyRecord,
        });
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
