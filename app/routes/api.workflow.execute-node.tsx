import type { Route } from "./+types/api.workflow.execute-node";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getDriveContext } from "~/services/google-drive.server";
import type {
  ServiceContext,
  WorkflowNode,
  WorkflowNodeType,
  ExecutionContext,
} from "~/engine/types";
import { getSettings } from "~/services/user-settings.server";
import { handleMcpNode } from "~/engine/handlers/mcp";
import { handleRagSyncNode } from "~/engine/handlers/ragSync";
import { handleGemihubCommandNode } from "~/engine/handlers/gemihubCommand";
import { handleSheetReadNode, handleSheetWriteNode, handleSheetUpdateNode, handleSheetDeleteNode } from "~/engine/handlers/hubworkSheets";
import { handleGmailSendNode } from "~/engine/handlers/hubworkGmail";
import { handleCalendarListNode, handleCalendarCreateNode, handleCalendarUpdateNode, handleCalendarDeleteNode } from "~/engine/handlers/hubworkCalendar";
import { getAccountByRootFolderId } from "~/services/hubwork-accounts.server";

// Server-only node types that this endpoint handles
// (most node types are now handled locally by local-executor.ts)
const SERVER_NODE_TYPES = new Set<WorkflowNodeType>([
  "mcp", "rag-sync", "gemihub-command",
  // Hubwork nodes (paid feature, server-only)
  "sheet-read", "sheet-write", "sheet-update", "sheet-delete", "gmail-send",
  "calendar-list", "calendar-create", "calendar-update", "calendar-delete",
]);

const SHEET_NODE_TYPES = new Set(["sheet-read", "sheet-write", "sheet-update", "sheet-delete"]);
const GMAIL_NODE_TYPES = new Set(["gmail-send"]);

interface DriveEvent {
  type: "updated" | "created" | "deleted";
  fileId: string;
  fileName: string;
  content?: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

interface LogEntryJSON {
  nodeId: string;
  nodeType: string;
  message: string;
  status: "info" | "success" | "error";
  timestamp: string;
  input?: Record<string, unknown>;
  output?: unknown;
  mcpApps?: import("~/types/chat").McpAppInfo[];
}

// POST: Execute a single node
export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders: Record<string, string> = {};
  if (setCookieHeader) responseHeaders["Set-Cookie"] = setCookieHeader;

  const body = await request.json();
  const {
    nodeType,
    nodeId,
    properties,
    variables,
  } = body as {
    nodeType: WorkflowNodeType;
    nodeId: string;
    properties: Record<string, string>;
    variables: Record<string, string | number>;
  };

  if (!nodeType || !SERVER_NODE_TYPES.has(nodeType)) {
    return Response.json(
      { error: `Unsupported node type for server execution: ${nodeType}` },
      { status: 400, headers: responseHeaders }
    );
  }

  // Hubwork nodes require a paid plan
  const HUBWORK_NODE_TYPES = new Set(["sheet-read", "sheet-write", "sheet-update", "sheet-delete", "gmail-send", "calendar-list", "calendar-create", "calendar-update", "calendar-delete"]);
  const node: WorkflowNode = {
    id: nodeId || "node",
    type: nodeType,
    properties: properties || {},
  };

  const context: ExecutionContext = {
    variables: new Map(Object.entries(variables || {})),
    logs: [],
  };

  const driveEvents: DriveEvent[] = [];
  const logs: LogEntryJSON[] = [];
  const abortController = new AbortController();

  // Handle client disconnect
  request.signal.addEventListener("abort", () => {
    abortController.abort();
  });

  const driveContext = await getDriveContext(validTokens);

  let settings;
  try {
    settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
  } catch { /* ignore */ }

  if (SHEET_NODE_TYPES.has(nodeType)) {
    const { hasProFeatures } = await import("~/types/hubwork");
    const hubworkAccount = await getAccountByRootFolderId(validTokens.rootFolderId);
    if (!hubworkAccount || !hasProFeatures(hubworkAccount)) {
      return Response.json(
        { error: "Hubwork Pro subscription required" },
        { status: 403, headers: responseHeaders }
      );
    }
  } else if (GMAIL_NODE_TYPES.has(nodeType)) {
    const { hasPaidFeatures } = await import("~/types/hubwork");
    const hubworkAccount = await getAccountByRootFolderId(validTokens.rootFolderId);
    if (!hubworkAccount || !hasPaidFeatures(hubworkAccount)) {
      return Response.json(
        { error: "Hubwork Lite or Pro subscription required" },
        { status: 403, headers: responseHeaders }
      );
    }
  }

  const serviceContext: ServiceContext = {
    driveAccessToken: validTokens.accessToken,
    driveRootFolderId: validTokens.rootFolderId,
    driveHistoryFolderId: driveContext.historyFolderId,
    geminiApiKey: validTokens.geminiApiKey,
    abortSignal: abortController.signal,
    editHistorySettings: settings?.editHistory,
    settings,
    onDriveFileUpdated: (data) => {
      driveEvents.push({ type: "updated", fileId: data.fileId, fileName: data.fileName, content: data.content });
    },
    onDriveFileCreated: (data) => {
      driveEvents.push({
        type: "created", fileId: data.fileId, fileName: data.fileName,
        content: data.content, md5Checksum: data.md5Checksum, modifiedTime: data.modifiedTime,
      });
    },
    onDriveFileDeleted: (data) => {
      driveEvents.push({ type: "deleted", fileId: data.fileId, fileName: data.fileName });
    },
  };

  // Populate Hubwork clients if enabled and needed
  const hubworkSpreadsheetId = settings?.hubwork?.spreadsheets?.[0]?.id || settings?.hubwork?.spreadsheetId;
  if (HUBWORK_NODE_TYPES.has(nodeType)) {
    const { google } = await import("googleapis");
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: validTokens.accessToken });
    if (hubworkSpreadsheetId) {
      serviceContext.hubworkSheetsClient = google.sheets({ version: "v4", auth: oauth2Client });
      serviceContext.hubworkSpreadsheetId = hubworkSpreadsheetId;
    }
    serviceContext.hubworkGmailClient = google.gmail({ version: "v1", auth: oauth2Client });
    serviceContext.hubworkCalendarClient = google.calendar({ version: "v3", auth: oauth2Client });
  }

  // Execute the server-side node and return JSON
  try {
    switch (nodeType) {
      case "mcp":
        await handleMcpNode(node, context, serviceContext);
        break;
      case "rag-sync":
        await handleRagSyncNode(node, context, serviceContext);
        break;
      case "gemihub-command":
        await handleGemihubCommandNode(node, context, serviceContext);
        break;
      // Hubwork nodes
      case "sheet-read":
        await handleSheetReadNode(node, context, serviceContext);
        break;
      case "sheet-write":
        await handleSheetWriteNode(node, context, serviceContext);
        break;
      case "sheet-update":
        await handleSheetUpdateNode(node, context, serviceContext);
        break;
      case "sheet-delete":
        await handleSheetDeleteNode(node, context, serviceContext);
        break;
      case "gmail-send":
        await handleGmailSendNode(node, context, serviceContext);
        break;
      case "calendar-list":
        await handleCalendarListNode(node, context, serviceContext);
        break;
      case "calendar-create":
        await handleCalendarCreateNode(node, context, serviceContext);
        break;
      case "calendar-update":
        await handleCalendarUpdateNode(node, context, serviceContext);
        break;
      case "calendar-delete":
        await handleCalendarDeleteNode(node, context, serviceContext);
        break;
    }

    const updatedVars: Record<string, string | number> = {};
    for (const [k, v] of context.variables) {
      updatedVars[k] = v;
    }

    // Collect logs from handler execution context
    for (const log of context.logs) {
      logs.push({
        nodeId: log.nodeId,
        nodeType: log.nodeType,
        message: log.message,
        status: log.status,
        timestamp: log.timestamp.toISOString(),
        input: log.input,
        output: log.output,
        mcpApps: log.mcpApps,
      });
    }

    return Response.json({ variables: updatedVars, logs, driveEvents }, { headers: responseHeaders });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: errorMessage, logs, driveEvents },
      { status: 500, headers: responseHeaders }
    );
  }
}
