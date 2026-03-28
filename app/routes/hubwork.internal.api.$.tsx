import { redirect } from "react-router";
import type { Route } from "./+types/hubwork.internal.api.$";
import { resolveAccountWithTokens } from "~/services/hubwork-account-resolver.server";
import { getSettings } from "~/services/user-settings.server";
import { getDriveContext, readFile } from "~/services/google-drive.server";
import { readRemoteSyncMeta } from "~/services/sync-meta.server";
import { buildApiIndex, resolveApiWorkflow } from "~/services/hubwork-api-resolver.server";
import { getContactEmail } from "~/services/hubwork-session.server";
import { buildCurrentUser } from "~/services/hubwork-page-renderer.server";
import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflow } from "~/engine/executor";
import type { WorkflowInput, ServiceContext } from "~/engine/types";
import { validateRedirectUrl, validateOrigin } from "~/utils/security";
import { checkRateLimit } from "~/services/hubwork-rate-limiter.server";
import { checkFormIdempotency } from "~/services/hubwork-form-submissions.server";
import { google } from "googleapis";

const ACCOUNT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB total
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

export async function loader({ request, params }: Route.LoaderArgs) {
  return handleApiRequest(request, params["*"] || "");
}

export async function action({ request, params }: Route.ActionArgs) {
  validateOrigin(request);
  return handleApiRequest(request, params["*"] || "");
}

async function handleApiRequest(request: Request, apiPath: string) {
  // Rate limit
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`api:ip:${clientIp}`, 60, 60 * 1000)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { account, tokens } = await resolveAccountWithTokens(request);

  // Workflow API requires Pro plan
  if (account.plan !== "pro" && account.plan !== "granted") {
    return Response.json({ error: "Hubwork Pro subscription required" }, { status: 403 });
  }

  const { accessToken, rootFolderId } = tokens;

  // Resolve workflow file from Drive
  const syncMeta = await readRemoteSyncMeta(accessToken, rootFolderId);
  if (!syncMeta) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const apiIndex = buildApiIndex(syncMeta);
  const resolved = resolveApiWorkflow(apiIndex, apiPath);
  if (!resolved) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Read and parse workflow YAML
  const yamlContent = await readFile(accessToken, resolved.fileId);
  const workflow = parseWorkflowYaml(yamlContent);
  const trigger = workflow.trigger || {};

  // Determine content type for response mode
  const contentType = request.headers.get("content-type") || "";
  const isFormRequest =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
  const isJsonResponse = !isFormRequest;

  // Auth check
  const requireAuth = trigger.requireAuth as string | undefined;
  let authEmail: string | null = null;
  let authType: string | null = null;
  let currentUserData: Record<string, unknown> | null = null;

  if (requireAuth) {
    if (!ACCOUNT_TYPE_PATTERN.test(requireAuth)) {
      return Response.json(
        { error: "Invalid requireAuth: must be a single account type" },
        { status: 400 }
      );
    }

    authEmail = await getContactEmail(request, requireAuth);
    if (!authEmail) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    authType = requireAuth;

    const settings = await getSettings(accessToken, rootFolderId);
    const accountType = settings?.hubwork?.accounts?.[requireAuth];
    const authSpreadsheetId = accountType?.identity?.spreadsheetId || settings?.hubwork?.spreadsheets?.[0]?.id || settings?.hubwork?.spreadsheetId;
    if (accountType?.data && authSpreadsheetId) {
      try {
        currentUserData = await buildCurrentUser(
          accessToken,
          authSpreadsheetId,
          authEmail,
          accountType.data,
        );
      } catch {
        // continue without currentUser
      }
    }
  }

  // Build input variables
  const variables = new Map<string, string | number>();

  // query.*
  const url = new URL(request.url);
  for (const [key, value] of url.searchParams) {
    variables.set(`query.${key}`, value);
  }

  // params.*
  for (const [key, value] of Object.entries(resolved.params)) {
    variables.set(`params.${key}`, value);
  }

  // request.method
  variables.set("request.method", request.method);

  // body.* (POST only)
  if (request.method === "POST") {
    if (contentType.includes("application/json")) {
      try {
        const jsonBody = await request.json();
        if (jsonBody && typeof jsonBody === "object") {
          for (const [key, value] of Object.entries(jsonBody)) {
            variables.set(`body.${key}`, typeof value === "number" ? value : String(value ?? ""));
          }
        }
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    } else if (isFormRequest) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return Response.json({ error: "Invalid form data" }, { status: 400 });
      }

      let totalSize = 0;
      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          if (value.size > MAX_FILE_SIZE) {
            return Response.json({ error: `File "${key}" exceeds 5MB limit` }, { status: 413 });
          }
          totalSize += value.size;
          if (totalSize > MAX_TOTAL_SIZE) {
            return Response.json({ error: "Total upload size exceeds 10MB limit" }, { status: 413 });
          }
          const buffer = await value.arrayBuffer();
          variables.set(`body.${key}`, Buffer.from(buffer).toString("base64"));
          variables.set(`body.${key}_name`, value.name);
          variables.set(`body.${key}_type`, value.type);
          variables.set(`body.${key}_size`, value.size);
        } else {
          variables.set(`body.${key}`, value);
        }
      }
    }
  }

  // auth.* and currentUser (only if requireAuth is set and authenticated)
  if (authType && authEmail) {
    variables.set("auth.type", authType);
    variables.set("auth.email", authEmail);
    if (currentUserData) {
      variables.set("currentUser", JSON.stringify(currentUserData));
    }
  }

  // Form-specific pre-processing
  if (isFormRequest) {
    // Honeypot check
    const honeypotField = trigger.honeypotField as string | undefined;
    if (honeypotField) {
      const honeypotValue = variables.get(`body.${honeypotField}`);
      if (honeypotValue && String(honeypotValue).length > 0) {
        const fallback = (trigger.successRedirect as string) || "/";
        return redirect(validateRedirectUrl(fallback, "/"));
      }
    }

    // Idempotency check
    const idempotencyKeyField = trigger.idempotencyKeyField as string | undefined;
    if (idempotencyKeyField) {
      const key = variables.get(`body.${idempotencyKeyField}`);
      if (key) {
        const isDuplicate = await checkFormIdempotency(account.id, String(key));
        if (isDuplicate) {
          const fallback = (trigger.successRedirect as string) || "/";
          return redirect(validateRedirectUrl(fallback, "/"));
        }
      }
    }
  }

  const abortController = new AbortController();

  // Build ServiceContext
  const settings = await getSettings(accessToken, rootFolderId);
  const driveContext = await getDriveContext({ accessToken, refreshToken: "", expiryTime: 0, rootFolderId });
  const serviceContext: ServiceContext = {
    driveAccessToken: accessToken,
    driveRootFolderId: rootFolderId,
    driveHistoryFolderId: driveContext.historyFolderId,
    abortSignal: abortController.signal,
    settings,
  };

  const defaultSpreadsheetId = settings?.hubwork?.spreadsheets?.[0]?.id || settings?.hubwork?.spreadsheetId;
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

  // Timeout
  const parsedTimeout = trigger.apiTimeoutSec ? parseInt(trigger.apiTimeoutSec as string, 10) : NaN;
  const timeoutMs = !isNaN(parsedTimeout) && parsedTimeout > 0
    ? Math.min(parsedTimeout * 1000, MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  // Propagate abort signal to ServiceContext so I/O handlers (HTTP, MCP, Drive) also respect the timeout
  serviceContext.abortSignal = abortController.signal;

  const input: WorkflowInput = { variables };

  try {
    const result = await executeWorkflow(workflow, input, serviceContext, undefined, {
      abortSignal: abortController.signal,
    });

    clearTimeout(timeoutId);

    if (isJsonResponse) {
      // JSON response mode
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
        // Return all non-__ variables
        const obj: Record<string, string | number> = {};
        for (const [k, v] of result.context.variables) {
          if (!k.startsWith("__")) {
            obj[k] = v;
          }
        }
        body = obj;
      }

      return Response.json(body, {
        status: statusCode,
        headers: { "Cache-Control": "no-store" },
      });
    } else {
      // Form redirect mode
      const redirectUrl = result.context.variables.get("__redirectUrl");
      if (redirectUrl) {
        return redirect(validateRedirectUrl(String(redirectUrl), "/"));
      }
      const bodyRedirect = variables.get("body.__redirect");
      if (bodyRedirect) {
        return redirect(validateRedirectUrl(String(bodyRedirect), "/"));
      }
      const successRedirect = trigger.successRedirect as string | undefined;
      if (successRedirect) {
        return redirect(validateRedirectUrl(successRedirect, "/"));
      }
      const referer = request.headers.get("Referer");
      if (referer) {
        try {
          return redirect(validateRedirectUrl(new URL(referer).pathname, "/"));
        } catch { /* fall through */ }
      }
      return redirect("/");
    }
  } catch (e) {
    clearTimeout(timeoutId);

    if (isJsonResponse) {
      if (e instanceof Error) {
        console.error(`[api] Workflow error for ${apiPath}:`, e.message);
      }
      return Response.json({ error: "Workflow execution failed" }, {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    } else {
      const errorRedirect = trigger.errorRedirect as string | undefined;
      if (errorRedirect) {
        return redirect(validateRedirectUrl(errorRedirect, "/"));
      }
      const referer = request.headers.get("Referer");
      if (referer) {
        try {
          return redirect(validateRedirectUrl(new URL(referer).pathname, "/"));
        } catch { /* fall through */ }
      }
      return redirect("/");
    }
  }
}
