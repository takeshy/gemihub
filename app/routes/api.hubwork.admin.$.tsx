import type { Route } from "./+types/api.hubwork.admin.$";
import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { getDriveContext, readFile } from "~/services/google-drive.server";
import { readRemoteSyncMeta } from "~/services/sync-meta.server";
import { buildAdminApiIndex, resolveAdminApiWorkflow } from "~/services/admin-api-resolver.server";
import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflow } from "~/engine/executor";
import type { WorkflowInput, ServiceContext } from "~/engine/types";
import { validateOrigin } from "~/utils/security";
import { google } from "googleapis";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

/**
 * Admin workflow endpoint — executes `admin/api/*.yaml` under the IDE-logged-in
 * user's Google OAuth session. Intended for the IDE "admin preview" iframe.
 *
 * Differs from the public `/__gemihub/api/*` handler in three ways:
 *   1. Auth: requires a valid IDE session cookie (Drive owner). Hubwork
 *      account-type checks are skipped — there is no `admin` account type.
 *   2. Path: resolves `admin/api/*.yaml` (not `web/api/`).
 *   3. Variables: injects `session.email` in place of the `auth.*` namespace.
 *      Workflows should use `{{session.email}}` for operator identity
 *      (`cancelled_by`, `reply_by`, etc.).
 *
 * The IDE session cookie is the auth boundary — any same-origin caller that
 * holds the cookie can hit this endpoint. The custom Hubwork domain only
 * serves files under `web/`, so `admin/api/*` is not reachable from there,
 * but that is a serving-layer property, not an authorization check. CSRF is
 * blocked by validateOrigin on both loader and action.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  validateOrigin(request);
  return handleAdminRequest(request, params["*"] || "");
}

export async function action({ request, params }: Route.ActionArgs) {
  validateOrigin(request);
  return handleAdminRequest(request, params["*"] || "");
}

async function handleAdminRequest(request: Request, apiPath: string) {
  // Path traversal / segment validation. The browser normalizes `..` in fetch
  // URLs before sending, so the bridge filter is the primary defense; this is
  // a server-side belt-and-braces check.
  if (!apiPath) {
    return Response.json({ error: "Empty path" }, { status: 400 });
  }
  const segments = apiPath.split("/");
  const isBadSegment = (seg: string) =>
    seg === "" || seg === "." || seg === ".." ||
    seg.includes("\\") || /%2e/i.test(seg);
  if (segments.some(isBadSegment)) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  const rawTokens = await getTokens(request);
  if (!rawTokens) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tokens } = await getValidTokens(request, rawTokens);
  const { accessToken, rootFolderId, email: sessionEmail } = tokens;
  if (!sessionEmail) {
    return Response.json({ error: "Session email missing" }, { status: 401 });
  }

  const syncMeta = await readRemoteSyncMeta(accessToken, rootFolderId);
  if (!syncMeta) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const apiIndex = buildAdminApiIndex(syncMeta);
  const resolved = resolveAdminApiWorkflow(apiIndex, apiPath);
  if (!resolved) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const yamlContent = await readFile(accessToken, resolved.fileId);
  const workflow = parseWorkflowYaml(yamlContent);
  const trigger = workflow.trigger || {};

  // Build input variables
  const variables = new Map<string, string | number>();

  const url = new URL(request.url);
  for (const [key, value] of url.searchParams) {
    variables.set(`request.query.${key}`, value);
  }
  for (const [key, value] of Object.entries(resolved.params)) {
    variables.set(`request.params.${key}`, value);
  }
  variables.set("request.method", request.method);

  // POST body — admin endpoint is JSON-only (the admin iframe always sends JSON)
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const jsonBody = await request.json();
        if (jsonBody && typeof jsonBody === "object") {
          for (const [key, value] of Object.entries(jsonBody)) {
            variables.set(
              `request.body.${key}`,
              typeof value === "number" ? value : String(value ?? ""),
            );
          }
        }
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
  }

  // session.* — operator identity for admin workflows.
  //
  // This is the admin-side analogue of the public handler's `auth.*`
  // namespace. `{{session.email}}` is the IDE-logged-in user's Google
  // account; use it for `cancelled_by`, `reply_by`, and any other
  // "who-did-this" column.
  variables.set("session.email", sessionEmail);
  variables.set("session", JSON.stringify({ email: sessionEmail }));

  // Build ServiceContext (reuse the same Hubwork clients as the public path
  // so sheet-*, gmail-send, calendar-* workflow nodes resolve).
  const settings = await getSettings(accessToken, rootFolderId);
  const driveContext = await getDriveContext({
    accessToken,
    refreshToken: "",
    expiryTime: 0,
    rootFolderId,
  });

  const abortController = new AbortController();
  const serviceContext: ServiceContext = {
    driveAccessToken: accessToken,
    driveRootFolderId: rootFolderId,
    driveHistoryFolderId: driveContext.historyFolderId,
    abortSignal: abortController.signal,
    settings,
  };

  const defaultSpreadsheetId = settings?.hubwork?.spreadsheets?.[0]?.id;
  {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    if (defaultSpreadsheetId) {
      serviceContext.hubworkSheetsClient = google.sheets({ version: "v4", auth: oauth2Client });
      serviceContext.hubworkSpreadsheetId = defaultSpreadsheetId;
    }
    serviceContext.hubworkGmailClient = google.gmail({ version: "v1", auth: oauth2Client });
    serviceContext.hubworkCalendarClient = google.calendar({ version: "v3", auth: oauth2Client });
  }

  const parsedTimeout = trigger.apiTimeoutSec ? parseInt(trigger.apiTimeoutSec as string, 10) : NaN;
  const timeoutMs = !isNaN(parsedTimeout) && parsedTimeout > 0
    ? Math.min(parsedTimeout * 1000, MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  const input: WorkflowInput = { variables };

  try {
    const result = await executeWorkflow(workflow, input, serviceContext, undefined, {
      abortSignal: abortController.signal,
    });
    clearTimeout(timeoutId);

    if (result.historyRecord?.status === "error") {
      const failingStep = result.historyRecord.steps.find((s) => s.status === "error");
      const stepError = failingStep?.error || "Workflow execution failed";
      console.error(`[admin-api] Workflow error for ${apiPath} at node ${failingStep?.nodeId}:`, stepError);
      return Response.json(
        { error: stepError, nodeId: failingStep?.nodeId },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    const responseVar = result.context.variables.get("__response");
    const statusCodeVar = result.context.variables.get("__statusCode");
    let statusCode = 200;
    if (statusCodeVar) {
      const parsed = parseInt(String(statusCodeVar), 10);
      if (!isNaN(parsed) && parsed >= 100 && parsed < 600) {
        statusCode = parsed;
      }
    }
    let body: unknown;
    if (responseVar !== undefined) {
      try {
        body = JSON.parse(String(responseVar));
      } catch {
        body = responseVar;
      }
    } else {
      body = {};
    }
    return Response.json(body, {
      status: statusCode,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error) {
      console.error(`[admin-api] Workflow error for ${apiPath}:`, e.message);
    }
    return Response.json({ error: "Workflow execution failed" }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
