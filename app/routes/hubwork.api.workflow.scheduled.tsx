import type { Route } from "./+types/hubwork.api.workflow.scheduled";
import { FieldValue } from "@google-cloud/firestore";
import { getSettingsForTenant } from "~/services/user-settings-tenant.server";
import { getSettings } from "~/services/user-settings.server";
import { mountContextForHubworkAccount } from "~/services/storage/account-mount.server";
import { listObjectsForSync, readObject } from "~/services/storage/provider.server";
import {
  personalVertexRunForSchedule,
  personalVertexExhaustedEmail,
  selectScheduledAccounts,
  shouldNotifyPersonalVertexExhausted,
} from "~/services/hubwork-scheduled.server";
import { sendHtmlEmail } from "~/services/hubwork-mail-send.server";
import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflow } from "~/engine/executor";
import type { WorkflowInput, ServiceContext } from "~/engine/types";
import {
  getAllActiveAccounts,
  getTokensForAccount,
  getActiveSchedules,
  getScheduleRuntimes,
  tryAcquireScheduleLock,
  updateScheduleRuntime,
  decryptGeminiApiKey,
} from "~/services/hubwork-accounts.server";
import { google } from "googleapis";

export function resolveScheduledWorkflowPath(paths: Iterable<string>, workflowPath: string): string | null {
  const trimmed = workflowPath.trim();
  if (!trimmed || trimmed.includes("\0") || trimmed.split("/").includes("..")) return null;
  return new Set(paths).has(trimmed) ? trimmed : null;
}

/**
 * Scheduled workflow execution endpoint.
 * Called by Cloud Scheduler (OIDC auth) or manually by admin.
 *
 * Reads scheduleIndex from Firestore (activeScheduleRevision),
 * checks scheduleRuntime for pending retries,
 * and executes matching workflows.
 */
export async function action({ request }: Route.ActionArgs) {
  await authorizeScheduledRequest(request);

  const allActive = await getAllActiveAccounts();
  const accounts = selectScheduledAccounts(allActive);
  if (accounts.length === 0) {
    return Response.json({ executed: 0, message: "No active accounts eligible for scheduled execution" });
  }

  const requestUrl = new URL(request.url);
  const settingsUrl = `${request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "")}://${requestUrl.host}/settings`;

  const now = new Date();
  const allResults: { accountId: string; workflowPath: string; status: string; error?: string }[] = [];

  for (const account of accounts) {
    try {
      // Read schedules from Firestore (activeScheduleRevision only)
      const schedules = await getActiveSchedules(account.id);
      if (schedules.length === 0) continue;

      const runtimes = await getScheduleRuntimes(account.id);

      // Determine which schedules to execute: cron match OR pending retry
      const toExecute: { schedule: typeof schedules[0]; isRetry: boolean }[] = [];
      for (const schedule of schedules) {
        if (!schedule.enabled) continue;
        const runtime = runtimes[schedule.id];
        const pendingRetry = runtime && runtime.retryCount > 0 && runtime.retryCount <= schedule.retry;

        // Check concurrency lock for local pre-filtering.
        // Actual lock acquisition is enforced transactionally before execution.
        if (schedule.concurrencyPolicy === "forbid" && runtime?.lockedUntil) {
          const lockDeadline = (runtime.lockedUntil as unknown as { toDate(): Date }).toDate();
          if (lockDeadline > now) {
            continue;
          }
        }

        if (pendingRetry) {
          toExecute.push({ schedule, isRetry: true });
        } else if (cronMatches(schedule.cron, now, schedule.timezone)) {
          toExecute.push({ schedule, isRetry: false });
        }
      }

      if (toExecute.length === 0) continue;

      // Fetch tokens and build context only when we have work to do
      const mountCtx = await mountContextForHubworkAccount(account);
      if (!mountCtx) {
        console.warn(`[hubwork-scheduled] No storage mount available for account ${account.id}`);
        continue;
      }
      const tokens = await getTokensForAccount(account);
      const { accessToken, rootFolderId } = tokens;
      // Business accounts read settings from the org's GCS project; Pro
      // accounts (Drive mount) read gemihub/settings.json from Drive.
      const settings = mountCtx.gcs
        ? await getSettingsForTenant(mountCtx.gcs)
        : await getSettings(accessToken, rootFolderId);
      const workflowObjects = await listObjectsForSync(mountCtx);
      const workflowPaths = workflowObjects.map((object) => object.relativePath);

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });

      // Decrypt Gemini API key from Hubwork account (stored by Settings/Unlock)
      let geminiApiKey: string | undefined;
      if (account.encryptedGeminiApiKey) {
        try {
          geminiApiKey = decryptGeminiApiKey(account.encryptedGeminiApiKey);
        } catch {
          console.warn(`[hubwork-scheduled] Failed to decrypt API key for account ${account.id}`);
        }
      }

      // Personal Vertex AI wins over a stored key when the user selected it
      // ("Vertex only"). The command node asserts the prepaid balance before
      // running and records usage afterwards; an empty balance throws and is
      // handled by the regular retry/lastError flow below.
      const personalVertex = mountCtx.gcs ? undefined : personalVertexRunForSchedule(settings, account.email);
      const serviceContext: ServiceContext = {
        driveAccessToken: accessToken,
        driveRootFolderId: rootFolderId,
        driveHistoryFolderId: "",
        settings,
        geminiApiKey: personalVertex ? undefined : geminiApiKey,
        personalVertex,
      };

      const hubworkSpreadsheetId = settings?.hubwork?.spreadsheets?.[0]?.id;
      if (hubworkSpreadsheetId) {
        serviceContext.hubworkSheetsClient = google.sheets({ version: "v4", auth: oauth2Client });
        serviceContext.hubworkSpreadsheetId = hubworkSpreadsheetId;
      }
      serviceContext.hubworkGmailClient = google.gmail({ version: "v1", auth: oauth2Client });
      serviceContext.hubworkCalendarClient = google.calendar({ version: "v3", auth: oauth2Client });

      for (const { schedule, isRetry } of toExecute) {
        try {
          const acquired = await tryAcquireScheduleLock({
            accountId: account.id,
            scheduleId: schedule.id,
            timeoutSec: schedule.timeoutSec,
            policy: schedule.concurrencyPolicy,
            now,
          });
          if (!acquired) {
            allResults.push({
              accountId: account.id,
              workflowPath: schedule.workflowPath,
              status: "skipped",
              error: "Schedule is already running",
            });
            continue;
          }

          const workflowPath = schedule.workflowPath.trim();
          const resolvedWorkflowPath = resolveScheduledWorkflowPath(workflowPaths, workflowPath);
          if (!resolvedWorkflowPath) {
            const resolutionError = workflowPath && !workflowPath.includes("\0") && !workflowPath.split("/").includes("..")
              ? "File not found"
              : "Invalid workflow path";
            await updateScheduleRuntime(account.id, schedule.id, {
              retryCount: 0,
              lockedUntil: FieldValue.delete(),
              lastError: resolutionError,
            });
            allResults.push({
              accountId: account.id,
              workflowPath: schedule.workflowPath,
              status: "error",
              error: resolutionError,
            });
            continue;
          }

          const { bytes: workflowBytes } = await readObject(mountCtx, resolvedWorkflowPath);
          const yamlContent = new TextDecoder("utf-8").decode(workflowBytes);
          const workflow = parseWorkflowYaml(yamlContent);

          const variables = new Map<string, string | number>(
            Object.entries(schedule.variables || {})
          );
          const input: WorkflowInput = { variables };

          const result = await executeWorkflow(workflow, input, serviceContext, undefined, {
            workflowName: schedule.workflowPath,
          });

          // Success — reset runtime state
          await updateScheduleRuntime(account.id, schedule.id, {
            retryCount: 0,
            lockedUntil: FieldValue.delete(),
            lastError: FieldValue.delete(),
            lastSuccessAt: now as unknown as import("@google-cloud/firestore").Timestamp,
          });

          allResults.push({
            accountId: account.id,
            workflowPath: schedule.workflowPath,
            status: result.historyRecord?.status || "completed",
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const runtime = runtimes[schedule.id];

          if (shouldNotifyPersonalVertexExhausted(error, runtime?.lastError)) {
            try {
              await sendHtmlEmail(serviceContext.hubworkGmailClient!, personalVertexExhaustedEmail(account.email, settingsUrl));
            } catch (mailError) {
              console.warn(`[hubwork-scheduled] Failed to send balance-exhausted notification for account ${account.id}:`, mailError);
            }
          }

          // Increment retryCount for deferred retry on next tick
          const newRetryCount = isRetry ? (runtime?.retryCount || 0) + 1 : 1;
          const exhausted = newRetryCount > schedule.retry;

          await updateScheduleRuntime(account.id, schedule.id, {
            retryCount: exhausted ? 0 : newRetryCount,
            lockedUntil: FieldValue.delete(),
            lastError: errMsg,
          });

          allResults.push({
            accountId: account.id,
            workflowPath: schedule.workflowPath,
            status: "error",
            error: errMsg,
          });
        }
      }
    } catch (error) {
      console.error(`[hubwork-scheduled] Error processing account ${account.id}:`, error);
    }
  }

  return Response.json({ executed: allResults.length, results: allResults });
}

async function authorizeScheduledRequest(request: Request): Promise<void> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    throw new Response("Missing Authorization header", { status: 401 });
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Response("Invalid Authorization header", { status: 401 });
  }

  const token = match[1];
  const audiences = getScheduledRequestAudiences(request);
  const ticket = await new google.auth.OAuth2().verifyIdToken({
    idToken: token,
    audience: audiences.length === 1 ? audiences[0] : audiences,
  });
  const payload = ticket.getPayload();
  if (!payload?.email) {
    throw new Response("Invalid scheduler token", { status: 401 });
  }

  const expectedSA = process.env.HUBWORK_SCHEDULER_SA_EMAIL;
  if (!expectedSA) {
    throw new Response("HUBWORK_SCHEDULER_SA_EMAIL is not configured", { status: 500 });
  }
  if (payload.email !== expectedSA) {
    console.warn(`[hubwork-scheduled] Rejected token from unexpected SA: ${payload.email}`);
    throw new Response("Unauthorized service account", { status: 403 });
  }
}

export function getScheduledRequestAudiences(request: Request): string[] {
  const configuredAudiences = (process.env.HUBWORK_SCHEDULER_AUDIENCE || "")
    .split(",")
    .map((audience) => audience.trim())
    .filter(Boolean);
  const requestOrigin = new URL(request.url).origin;

  return Array.from(new Set([...configuredAudiences, requestOrigin]));
}

// Simple cron expression matcher (minute hour dayOfMonth month dayOfWeek).
// Supports: numbers, *, step values, lists, ranges.
function cronMatches(cron: string, date: Date, timezone?: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const zoned = getDateParts(date, timezone || "UTC");
  const values = [
    zoned.minute,
    zoned.hour,
    zoned.dayOfMonth,
    zoned.month,
    zoned.dayOfWeek,
  ];

  return parts.every((part, i) => fieldMatches(part, values[i]));
}

function getDateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const byType = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    minute: Number.parseInt(byType("minute"), 10),
    hour: Number.parseInt(byType("hour"), 10),
    dayOfMonth: Number.parseInt(byType("day"), 10),
    month: Number.parseInt(byType("month"), 10),
    dayOfWeek: weekdayMap[byType("weekday")] ?? date.getUTCDay(),
  };
}

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;

  // Step: */n
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  // List: 1,2,3
  if (field.includes(",")) {
    return field.split(",").some((f) => fieldMatches(f.trim(), value));
  }

  // Range: 1-5
  if (field.includes("-")) {
    const [start, end] = field.split("-").map(Number);
    return !isNaN(start) && !isNaN(end) && value >= start && value <= end;
  }

  // Exact number
  return parseInt(field, 10) === value;
}
