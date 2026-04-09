import type { Route } from "./+types/hubwork.api.workflow.scheduled";
import { FieldValue } from "@google-cloud/firestore";
import { getDriveContext, readFile } from "~/services/google-drive.server";
import { getSettings } from "~/services/user-settings.server";
import { readRemoteSyncMeta } from "~/services/sync-meta.server";
import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflow } from "~/engine/executor";
import type { WorkflowInput, ServiceContext } from "~/engine/types";
import type { SyncMeta } from "~/services/sync-diff";
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

export function resolveScheduledWorkflowFileId(syncMeta: SyncMeta, workflowPath: string): string | null {
  const trimmed = workflowPath.trim();
  if (!trimmed || trimmed.includes("\0") || trimmed.includes("..")) {
    return null;
  }
  const entry = Object.entries(syncMeta.files).find(([, meta]) => meta.name === trimmed);
  return entry?.[0] ?? null;
}

export function getScheduledWorkflowResolutionError(syncMeta: SyncMeta, workflowPath: string): string {
  const trimmed = workflowPath.trim();
  if (!trimmed || trimmed.includes("\0") || trimmed.includes("..")) {
    return "Invalid workflow path";
  }
  return Object.values(syncMeta.files).some((meta) => meta.name === trimmed)
    ? "Invalid workflow path"
    : "File not found";
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
  // Scheduled workflows require Pro plan
  const accounts = allActive.filter(a => a.plan === "pro" || a.plan === "granted");
  if (accounts.length === 0) {
    return Response.json({ executed: 0, message: "No active Pro accounts" });
  }

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
      const tokens = await getTokensForAccount(account);
      const { accessToken, rootFolderId } = tokens;
      const settings = await getSettings(accessToken, rootFolderId);
      const driveContext = await getDriveContext({ accessToken, refreshToken: "", expiryTime: 0, rootFolderId });
      const syncMeta = await readRemoteSyncMeta(accessToken, rootFolderId);
      if (!syncMeta) {
        console.warn(`[hubwork-scheduled] Missing sync meta for account ${account.id}`);
        continue;
      }

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

      const serviceContext: ServiceContext = {
        driveAccessToken: accessToken,
        driveRootFolderId: rootFolderId,
        driveHistoryFolderId: driveContext.historyFolderId,
        settings,
        geminiApiKey,
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
          const workflowFileId = resolveScheduledWorkflowFileId(syncMeta, workflowPath);
          if (!workflowFileId) {
            const resolutionError = getScheduledWorkflowResolutionError(syncMeta, workflowPath);
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

          const yamlContent = await readFile(accessToken, workflowFileId);
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
  const audience = new URL(request.url).origin;
  const ticket = await new google.auth.OAuth2().verifyIdToken({
    idToken: token,
    audience,
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
