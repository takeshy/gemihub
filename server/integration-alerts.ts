import { createHmac } from "node:crypto";
import { isArchivedShop, type Shop, type Store } from "./store.ts";

export type IntegrationType = "mail" | "drive";
export type IntegrationErrorClass = "auth" | "config" | "transient" | "unknown" | "final";
export type IntegrationTerminalReason = "sent" | "failed_final" | "obsolete" | "unavailable";
export type IntegrationMailKind =
  | "booking_confirmation"
  | "cancellation"
  | "refund_result"
  | "reminder"
  | "inquiry_reply"
  | "inquiry_receipt"
  | "waitlist"
  | "staff_invite"
  | "login"
  | "phone"
  | "booking"
  | "transfer";

export type IntegrationJob = {
  id: string;
  shopId: string;
  type: "mail" | "posts";
  attempts?: number;
  createdAt?: string;
  mailKind?: IntegrationMailKind | string;
  bookingId?: string;
  bookingStart?: string;
  inquiryId?: string;
  inquiryInteractionId?: string;
  firstFailedAt?: string;
  lastAttemptAt?: string;
  lastErrorCode?: string;
  lastErrorClass?: IntegrationErrorClass;
  terminalReason?: IntegrationTerminalReason;
  incidentId?: string;
};

export type IntegrationIncident = {
  id: string;
  baseKey: string;
  shopId: string;
  type: IntegrationType;
  errorClass: IntegrationErrorClass;
  generation: number;
  errorCode?: string;
  mailKind?: string;
  bookingId?: string;
  bookingStart?: string;
  inquiryId?: string;
  stalled?: boolean;
  terminal?: boolean;
  openedAt: string;
  lastFailureAt: string;
  lastSuccessAt?: string;
  failureCount: number;
  affectedCount: number;
  firstNotifiedAt?: string;
  lastNotifiedAt?: string;
  nextSummaryAt?: string;
  summarySeq?: number;
  status: "open" | "notified" | "resolved" | "ended";
  resolvedAt?: string;
  resolution?: "succeeded" | "obsolete" | "unavailable" | "archived";
  logId?: string;
};

export type IntegrationEvent = "opened" | "summary" | "recovered" | "ended";

export type IntegrationPayload = {
  environment: string;
  shopId: string;
  incidentId: string;
  event: IntegrationEvent;
  type: IntegrationType;
  mailKind?: string;
  errorClass: IntegrationErrorClass;
  errorCode?: string;
  openedAt: string;
  occurredAt: string;
  durationMinutes: number;
  affectedCount: number;
  failureCount: number;
  retryState: string;
  logId?: string;
  link?: string;
};

export type NotificationOutboxItem = {
  id: string;
  incidentId: string;
  shopId: string;
  event: IntegrationEvent;
  payload: IntegrationPayload;
  createdAt: string;
  nextAt: string;
  firstFailedAt?: string;
  stalledAt?: string;
  attempts: number;
  status: "pending" | "sent" | "failed";
  lastErrorCode?: string;
};

export type OwnerIntegrationAlert = {
  id: string;
  kind: "reconnect" | "mail_delay" | "inquiry_failed" | "drive_delay";
  type: IntegrationType;
  since: string;
  affectedCount: number;
  inquiryId?: string;
};

export type WebhookFormat = "generic" | "slack" | "google_chat";
export type WebhookSender = (url: string, body: string, headers: Record<string, string>) => Promise<void>;

type Config = {
  mailFailureMinutes: number;
  driveFailureMinutes: number;
  failureCount: number;
  mailStallMinutes: number;
  driveStallMinutes: number;
  summaryHours: number;
  ownerMailDelayMinutes: number;
  ownerNearVisitHours: number;
};

type Options = {
  store: Store;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  send?: WebhookSender;
  appOrigin?: () => string;
  log?: (event: string, data: Record<string, unknown>) => void;
};

const AUTH_REASONS = new Set([
  "invalid_grant",
  "unauthorized_client",
  "insufficient_permissions",
  "access_token_scope_insufficient",
  "invalid_credentials",
  "unauthenticated",
]);
const RATE_REASONS = new Set([
  "rate_limit_exceeded",
  "user_rate_limit_exceeded",
  "quota_exceeded",
  "resource_exhausted",
  "billing_rate_limit",
]);
const CONFIG_REASONS = new Set([
  "service_disabled",
  "access_not_configured",
  "domain_policy",
  "forbidden",
  "access_denied",
]);
const BACKOFF_SECONDS = [60, 120, 300, 900, 1800, 3600];

const iso = (value: number) => new Date(value).toISOString();
const ageMinutes = (from: string | undefined, now: number) => {
  const started = from ? Date.parse(from) : NaN;
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 60000)) : 0;
};
export const incidentBaseKey = (shopId: string, type: IntegrationType, errorClass: IntegrationErrorClass) => `${shopId}:${type}:${errorClass}`;

function numberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function configOf(env: NodeJS.ProcessEnv): Config {
  return {
    mailFailureMinutes: numberEnv(env, "OPS_MAIL_FAILURE_MINUTES", 5),
    driveFailureMinutes: numberEnv(env, "OPS_DRIVE_FAILURE_MINUTES", 15),
    failureCount: numberEnv(env, "OPS_FAILURE_COUNT", 3),
    mailStallMinutes: numberEnv(env, "OPS_MAIL_STALL_MINUTES", 5),
    driveStallMinutes: numberEnv(env, "OPS_DRIVE_STALL_MINUTES", 15),
    summaryHours: numberEnv(env, "OPS_SUMMARY_HOURS", 6),
    ownerMailDelayMinutes: numberEnv(env, "OPS_OWNER_MAIL_DELAY_MINUTES", 30),
    ownerNearVisitHours: numberEnv(env, "OPS_OWNER_NEAR_VISIT_HOURS", 2),
  };
}

function safeCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  const code = value.trim().replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
  return /^[A-Za-z0-9_]{2,64}$/.test(code) ? code : undefined;
}

function normalizeReason(value: string | undefined) {
  if (!value) return undefined;
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function errorDetails(error: unknown) {
  const value = error as {
    status?: unknown;
    code?: unknown;
    reason?: unknown;
    errors?: { reason?: unknown }[];
    response?: { status?: unknown; data?: { error?: { status?: unknown; errors?: { reason?: unknown }[] } } };
    cause?: { status?: unknown; reason?: unknown };
  } | null;
  const status = Number(
    value?.status ??
    (typeof value?.code === "number" ? value.code : undefined) ??
    value?.response?.status ??
    value?.cause?.status,
  ) || undefined;
  const reason = normalizeReason(
    safeCode(value?.errors?.[0]?.reason) ||
    safeCode(value?.response?.data?.error?.errors?.[0]?.reason) ||
    safeCode(value?.cause?.reason) ||
    safeCode(value?.reason) ||
    (typeof value?.code === "string" ? safeCode(value.code) : undefined) ||
    safeCode(value?.response?.data?.error?.status),
  );
  const errorCode = reason || (status ? `HTTP_${status}` : undefined);
  return { status, reason, errorCode };
}

export function classifyIntegrationError(error: unknown, options: { final?: boolean } = {}): {
  errorClass: IntegrationErrorClass;
  errorCode: string;
} {
  const { status, reason, errorCode = "UNKNOWN" } = errorDetails(error);
  if (options.final) return { errorClass: "final", errorCode };
  if ((error as { name?: string } | null)?.name === "ZodError" || status === 400 || status === 422)
    return { errorClass: "config", errorCode };
  if (status === 401) return { errorClass: "auth", errorCode };
  if (status === 403) {
    if (reason && AUTH_REASONS.has(reason)) return { errorClass: "auth", errorCode };
    if (reason && RATE_REASONS.has(reason)) return { errorClass: "transient", errorCode };
    if (reason && CONFIG_REASONS.has(reason)) return { errorClass: "config", errorCode };
    return { errorClass: "unknown", errorCode };
  }
  if (status === 429 || (status !== undefined && status >= 500))
    return { errorClass: "transient", errorCode };
  if (reason && RATE_REASONS.has(reason)) return { errorClass: "transient", errorCode };
  if (reason && CONFIG_REASONS.has(reason)) return { errorClass: "config", errorCode };
  if (reason && AUTH_REASONS.has(reason)) return { errorClass: "auth", errorCode };
  return { errorClass: "unknown", errorCode };
}

const jobType = (job: IntegrationJob): IntegrationType => job.type === "posts" ? "drive" : "mail";
const openStatus = (incident: IntegrationIncident) => incident.status === "open" || incident.status === "notified";

function payloadFor(incident: IntegrationIncident, event: IntegrationEvent, now: number, link: string | undefined, env: NodeJS.ProcessEnv): IntegrationPayload {
  return {
    environment: env.APP_ENV || env.NODE_ENV || "development",
    shopId: incident.shopId,
    incidentId: incident.id,
    event,
    type: incident.type,
    ...(incident.mailKind ? { mailKind: incident.mailKind } : {}),
    errorClass: incident.errorClass,
    ...(incident.errorCode ? { errorCode: incident.errorCode } : {}),
    openedAt: incident.openedAt,
    occurredAt: iso(now),
    durationMinutes: ageMinutes(incident.openedAt, now),
    affectedCount: incident.affectedCount,
    failureCount: incident.failureCount,
    retryState: incident.errorClass === "final" || incident.terminal ? "stopped" : "automatic retry",
    ...(incident.logId ? { logId: incident.logId } : {}),
    ...(link ? { link } : {}),
  };
}

function notificationLine(payload: IntegrationPayload) {
  return [
    `[${payload.environment}] ${payload.event}: ${payload.type}`,
    `shop=${payload.shopId}`,
    `incident=${payload.incidentId}`,
    `class=${payload.errorClass}`,
    payload.errorCode ? `code=${payload.errorCode}` : "",
    `affected=${payload.affectedCount}`,
    `duration=${payload.durationMinutes}m`,
  ].filter(Boolean).join(" ");
}

export function formatWebhookPayload(format: WebhookFormat, payload: IntegrationPayload): unknown {
  const text = notificationLine(payload);
  if (format === "slack") {
    return {
      text,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `gemihub ${payload.event}` } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Shop*\n${payload.shopId}` },
            { type: "mrkdwn", text: `*Operation*\n${payload.type}` },
            { type: "mrkdwn", text: `*Class*\n${payload.errorClass}` },
            { type: "mrkdwn", text: `*Code*\n${payload.errorCode || "-"}` },
            { type: "mrkdwn", text: `*Affected*\n${payload.affectedCount}` },
            { type: "mrkdwn", text: `*Duration*\n${payload.durationMinutes} min` },
          ],
        },
        { type: "context", elements: [{ type: "mrkdwn", text: payload.link ? `<${payload.link}|Open in gemihub>` : `incident ${payload.incidentId}` }] },
      ],
    };
  }
  if (format === "google_chat") return { text };
  return payload;
}

export function integrationAlerts(options: Options) {
  const { store, env = process.env } = options;
  const now = options.now || Date.now;
  const config = () => configOf(env);
  const log = options.log || ((event, data) => console.error(JSON.stringify({ event, ...data })));
  const sender: WebhookSender = options.send || (async (url, body, headers) => {
    const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Object.assign(new Error(`webhook_${response.status}`), { status: response.status });
  });
  const webhookFormat = (): WebhookFormat | undefined => {
    const value = env.OPS_WEBHOOK_FORMAT?.trim();
    if (!value) return "generic";
    if (value === "slack" || value === "google_chat" || value === "generic") return value;
    log("ops_notify_invalid_format", { format: value });
    return undefined;
  };

  async function incidents(shop: Shop) {
    return (await store.entries<IntegrationIncident>("integrationIncident", shop)).map(entry => entry.value);
  }
  async function openIncidents(shop: Shop) {
    return (await incidents(shop)).filter(openStatus);
  }
  async function nextGeneration(baseKey: string) {
    const current = await store.get<{ generation: number }>("integrationIncidentSeq", baseKey);
    const generation = (current?.generation || 0) + 1;
    await store.put("integrationIncidentSeq", baseKey, { generation, updatedAt: iso(now()) });
    return generation;
  }

  async function upsertIncident(input: {
    shop: Shop;
    type: IntegrationType;
    errorClass: IntegrationErrorClass;
    errorCode?: string;
    mailKind?: string;
    bookingId?: string;
    bookingStart?: string;
    inquiryId?: string;
    stalled?: boolean;
    terminal?: boolean;
    openedAt?: string;
    firstFailure?: boolean;
  }) {
    const baseKey = incidentBaseKey(input.shop.id, input.type, input.errorClass);
    return store.locked(`integration:${baseKey}`, async () => {
      const existing = (await openIncidents(input.shop))
        .filter(incident => incident.baseKey === baseKey)
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0];
      const at = iso(now());
      if (existing) {
        const updated: IntegrationIncident = {
          ...existing,
          lastFailureAt: at,
          failureCount: existing.failureCount + 1,
          affectedCount: existing.affectedCount + (input.firstFailure ? 1 : 0),
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          ...(input.mailKind ? { mailKind: input.mailKind } : {}),
          ...(input.bookingId ? { bookingId: input.bookingId } : {}),
          ...(input.bookingStart ? { bookingStart: input.bookingStart } : {}),
          ...(input.inquiryId ? { inquiryId: input.inquiryId } : {}),
          ...(input.stalled ? { stalled: true } : {}),
          ...(input.terminal ? { terminal: true } : {}),
        };
        await store.put("integrationIncident", updated.id, updated);
        return updated;
      }
      const generation = await nextGeneration(baseKey);
      const incident: IntegrationIncident = {
        id: `${baseKey}:${generation}`,
        baseKey,
        shopId: input.shop.id,
        type: input.type,
        errorClass: input.errorClass,
        generation,
        openedAt: input.openedAt || at,
        lastFailureAt: at,
        failureCount: 1,
        affectedCount: input.firstFailure === false ? 0 : 1,
        status: "open",
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        ...(input.mailKind ? { mailKind: input.mailKind } : {}),
        ...(input.bookingId ? { bookingId: input.bookingId } : {}),
        ...(input.bookingStart ? { bookingStart: input.bookingStart } : {}),
        ...(input.inquiryId ? { inquiryId: input.inquiryId } : {}),
        ...(input.stalled ? { stalled: true } : {}),
        ...(input.terminal ? { terminal: true } : {}),
      };
      await store.put("integrationIncident", incident.id, incident);
      return incident;
    });
  }

  async function enqueueOutbox(incident: IntegrationIncident, event: IntegrationEvent, version: number | string) {
    if (!env.OPS_WEBHOOK_URL?.trim()) return;
    const id = `${incident.id}:${event}:${version}`;
    if (await store.get("notificationOutbox", id)) return;
    const at = iso(now());
    const origin = options.appOrigin?.();
    const link = origin ? `${origin}/?shop=${encodeURIComponent(incident.shopId)}` : undefined;
    const payload = payloadFor(incident, event, now(), link, env);
    await store.put("notificationOutbox", id, {
      id,
      incidentId: incident.id,
      shopId: incident.shopId,
      event,
      payload,
      createdAt: at,
      nextAt: at,
      attempts: 0,
      status: "pending",
    } satisfies NotificationOutboxItem);
  }

  function shouldNotify(incident: IntegrationIncident, at: number) {
    if (incident.firstNotifiedAt) return false;
    const minutes = incident.type === "mail" ? config().mailFailureMinutes : config().driveFailureMinutes;
    if (incident.errorClass !== "transient") return true;
    if (incident.stalled) return ageMinutes(incident.openedAt, at) >= minutes;
    return ageMinutes(incident.openedAt, at) >= minutes && incident.failureCount >= config().failureCount;
  }

  async function notifyOpened(incident: IntegrationIncident) {
    if (!shouldNotify(incident, now())) return incident;
    await enqueueOutbox(incident, "opened", 1);
    const at = iso(now());
    const updated: IntegrationIncident = {
      ...incident,
      firstNotifiedAt: at,
      lastNotifiedAt: at,
      nextSummaryAt: iso(now() + config().summaryHours * 3600000),
      status: "notified",
    };
    await store.put("integrationIncident", updated.id, updated);
    return updated;
  }

  async function refreshIncident(incident: IntegrationIncident) {
    if (!openStatus(incident)) return incident;
    let current = incident;
    if (!current.firstNotifiedAt) current = await notifyOpened(current);
    if (!current.firstNotifiedAt || !current.nextSummaryAt) return current;
    if (now() < Date.parse(current.nextSummaryAt)) return current;
    const seq = (current.summarySeq || 0) + 1;
    await enqueueOutbox(current, "summary", seq);
    const updated: IntegrationIncident = {
      ...current,
      summarySeq: seq,
      lastNotifiedAt: iso(now()),
      nextSummaryAt: iso(now() + config().summaryHours * 3600000),
    };
    await store.put("integrationIncident", updated.id, updated);
    return updated;
  }

  async function closeIncident(incident: IntegrationIncident, resolution: "succeeded" | "obsolete" | "unavailable" | "archived") {
    return store.locked(`integration:${incident.baseKey}`, async () => {
      const current = await store.get<IntegrationIncident>("integrationIncident", incident.id);
      if (!current || !openStatus(current)) return current;
      const at = iso(now());
      const updated: IntegrationIncident = {
        ...current,
        status: resolution === "succeeded" ? "resolved" : "ended",
        resolution,
        resolvedAt: at,
        ...(resolution === "succeeded" ? { lastSuccessAt: at } : {}),
      };
      await store.put("integrationIncident", updated.id, updated);
      if (current.firstNotifiedAt) await enqueueOutbox(updated, resolution === "succeeded" ? "recovered" : "ended", 1);
      return updated;
    });
  }

  function matchesJob(incident: IntegrationIncident, job: IntegrationJob) {
    if (job.incidentId === incident.id) return true;
    if (job.lastErrorClass === incident.errorClass) return true;
    return incident.errorClass === "auth";
  }

  async function remainingJobs(shop: Shop, type: IntegrationType, incident: IntegrationIncident, excludeJobId?: string) {
    return (await store.list<IntegrationJob>("job")).filter(job =>
      job.shopId === shop.id && jobType(job) === type && job.id !== excludeJobId && matchesJob(incident, job));
  }

  async function recordFailure(input: { shop: Shop; job: IntegrationJob; error: unknown; final?: boolean; firstFailure?: boolean; stalled?: boolean; openedAt?: string }) {
    const classified = classifyIntegrationError(input.error);
    const errorClass: IntegrationErrorClass = input.final && classified.errorClass !== "auth" && classified.errorClass !== "config"
      ? "final"
      : classified.errorClass;
    const { errorCode } = classified;
    const type = jobType(input.job);
    let incident = await upsertIncident({
      shop: input.shop,
      type,
      errorClass,
      errorCode,
      ...(input.job.mailKind ? { mailKind: input.job.mailKind } : {}),
      ...(input.job.bookingId ? { bookingId: input.job.bookingId } : {}),
      ...(input.job.bookingStart ? { bookingStart: input.job.bookingStart } : {}),
      ...(input.job.inquiryId ? { inquiryId: input.job.inquiryId } : {}),
      ...(input.stalled ? { stalled: true } : {}),
      ...(input.final ? { terminal: true } : {}),
      ...(input.openedAt ? { openedAt: input.openedAt } : {}),
      firstFailure: input.firstFailure ?? !input.job.firstFailedAt,
    });
    incident = await notifyOpened(incident);
    if (input.final) {
      // The job will not retry, so an earlier transient incident for the same job is finished, not recovered.
      for (const other of await openIncidents(input.shop)) {
        if (other.id === incident.id || other.type !== type || !matchesJob(other, input.job)) continue;
        if (!(await remainingJobs(input.shop, type, other, input.job.id)).length)
          await closeIncident(other, "unavailable");
      }
    }
    return { incident, errorClass, errorCode };
  }

  async function recordBlocked(input: { shop: Shop; type: IntegrationType; mailKind?: string }) {
    if (input.shop.judge) return;
    const key = `${input.shop.id}:${input.type}:${input.mailKind || "unknown"}`;
    const last = await store.get<{ at: string }>("integrationBlocked", key);
    if (last && now() - Date.parse(last.at) < 3600000) return;
    await store.put("integrationBlocked", key, { shopId: input.shop.id, at: iso(now()) });
    let incident = await upsertIncident({ shop: input.shop, type: input.type, errorClass: "auth", errorCode: "GOOGLE_NOT_CONNECTED", ...(input.mailKind ? { mailKind: input.mailKind } : {}), firstFailure: true });
    incident = await notifyOpened(incident);
    return incident;
  }

  async function recordAuthStop(shop: Shop, job: IntegrationJob, code: string) {
    const key = `${shop.id}:${jobType(job)}:${code}`;
    const last = await store.get<{ at: string }>("integrationBlocked", key);
    if (last && now() - Date.parse(last.at) < 600000) return undefined;
    await store.put("integrationBlocked", key, { shopId: shop.id, at: iso(now()) });
    let incident = await upsertIncident({
      shop,
      type: jobType(job),
      errorClass: "auth",
      errorCode: code,
      ...(job.mailKind ? { mailKind: job.mailKind } : {}),
      ...(job.bookingId ? { bookingId: job.bookingId } : {}),
      ...(job.bookingStart ? { bookingStart: job.bookingStart } : {}),
      ...(job.inquiryId ? { inquiryId: job.inquiryId } : {}),
      firstFailure: !job.incidentId,
    });
    incident = await notifyOpened(incident);
    return incident;
  }

  async function recordSuccess(input: { shop: Shop; job: IntegrationJob }) {
    for (const incident of (await openIncidents(input.shop)).filter(item => item.type === jobType(input.job))) {
      if (!matchesJob(incident, input.job)) continue;
      if (!(await remainingJobs(input.shop, incident.type, incident, input.job.id)).length)
        await closeIncident(incident, "succeeded");
    }
  }

  async function recordObsolete(input: { shop: Shop; job: IntegrationJob }) {
    for (const incident of (await openIncidents(input.shop)).filter(item => item.type === jobType(input.job))) {
      if (!matchesJob(incident, input.job)) continue;
      if (!(await remainingJobs(input.shop, incident.type, incident, input.job.id)).length)
        await closeIncident(incident, "obsolete");
    }
  }

  async function sweepShop(shop: Shop, options: { hasToken: boolean }) {
    const jobs = (await store.list<IntegrationJob>("job")).filter(job => job.shopId === shop.id);
    for (const job of jobs) {
      const type = jobType(job);
      if (!shop.google) {
        await recordBlocked({ shop, type, ...(job.mailKind ? { mailKind: job.mailKind } : {}) });
        continue;
      }
      if (!options.hasToken) {
        await recordAuthStop(shop, job, "TOKEN_MISSING");
        continue;
      }
      const last = Date.parse(job.lastAttemptAt || job.firstFailedAt || job.createdAt || "");
      if (!Number.isFinite(last)) continue;
      const minutes = type === "mail" ? config().mailStallMinutes : config().driveStallMinutes;
      if (now() - last < minutes * 60000) continue;
      const error = Object.assign(new Error("stalled"), { status: 504, code: "JOB_STALLED" });
      const result = await recordFailure({ shop, job, error, firstFailure: !job.firstFailedAt, stalled: true, openedAt: job.lastAttemptAt || job.firstFailedAt || job.createdAt });
      if (job.incidentId !== result.incident.id || !job.firstFailedAt)
        await store.put("job", job.id, {
          ...job,
          incidentId: result.incident.id,
          lastErrorClass: result.errorClass,
          lastErrorCode: result.errorCode,
          firstFailedAt: job.firstFailedAt || iso(now() - minutes * 60000),
        });
    }
    for (const incident of await openIncidents(shop)) await refreshIncident(incident);
  }

  async function deliver(item: NotificationOutboxItem) {
    const url = env.OPS_WEBHOOK_URL?.trim();
    if (!url) {
      await store.put("notificationOutbox", item.id, { ...item, nextAt: iso(now() + 3600000), lastErrorCode: "NO_WEBHOOK" });
      return;
    }
    const format = webhookFormat();
    if (!format) {
      await store.put("notificationOutbox", item.id, { ...item, nextAt: iso(now() + 3600000), lastErrorCode: "INVALID_FORMAT" });
      return;
    }
    const body = JSON.stringify(formatWebhookPayload(format, item.payload));
    const timestamp = Math.floor(now() / 1000).toString();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": item.id,
      "X-Gemihub-Timestamp": timestamp,
    };
    const secret = env.OPS_WEBHOOK_SECRET;
    if (secret) headers["X-Gemihub-Signature"] = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
    try {
      await sender(url, body, headers);
      await store.put("notificationOutbox", item.id, { ...item, status: "sent", lastErrorCode: undefined });
    } catch (error) {
      const attempts = item.attempts + 1;
      const at = iso(now());
      const firstFailedAt = item.firstFailedAt || at;
      const nextAt = iso(now() + BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)] * 1000);
      const updated: NotificationOutboxItem = { ...item, attempts, firstFailedAt, nextAt, lastErrorCode: errorDetails(error).errorCode || "WEBHOOK_FAILED" };
      if (now() - Date.parse(firstFailedAt) >= 86400000 && !item.stalledAt) {
        updated.stalledAt = at;
        log("ops_notify_failed", { incidentId: item.incidentId, outboxId: item.id, attempts, errorCode: updated.lastErrorCode });
      }
      await store.put("notificationOutbox", item.id, updated);
    }
  }

  async function processOutbox() {
    for (const { value: item } of await store.entries<NotificationOutboxItem>("notificationOutbox")) {
      if (item.status === "sent" && now() - Date.parse(item.createdAt) > 30 * 86400000) {
        await store.delete("notificationOutbox", item.id);
        continue;
      }
      if (item.status !== "pending" || Date.parse(item.nextAt) > now()) continue;
      await store.locked(`ops-notify:${item.id}`, async () => {
        const current = await store.get<NotificationOutboxItem>("notificationOutbox", item.id);
        if (!current || current.status !== "pending" || Date.parse(current.nextAt) > now()) return;
        await deliver(current);
      });
    }
  }

  async function endArchived(shops: Shop[]) {
    const active = new Map(shops.filter(shop => !isArchivedShop(shop)).map(shop => [shop.id, shop]));
    const all = await store.entries<IntegrationIncident>("integrationIncident");
    for (const { value: incident } of all) {
      if (!openStatus(incident)) continue;
      const shop = active.get(incident.shopId);
      if (!shop) await closeIncident(incident, "archived");
    }
  }

  function reconnectIncident(incident: IntegrationIncident) {
    return incident.errorClass === "auth";
  }

  function ownerAlertsFor(shop: Shop, at: number) {
    return incidents(shop).then(all => {
      const byKind = new Map<OwnerIntegrationAlert["kind"], OwnerIntegrationAlert>();
      const add = (alert: OwnerIntegrationAlert) => {
        const current = byKind.get(alert.kind);
        if (!current || alert.since < current.since) byKind.set(alert.kind, alert);
        else current.affectedCount = Math.max(current.affectedCount, alert.affectedCount);
      };
      for (const incident of all.filter(openStatus)) {
        if (reconnectIncident(incident)) {
          add({ id: incident.id, kind: "reconnect", type: incident.type, since: incident.openedAt, affectedCount: incident.affectedCount });
          continue;
        }
        if (incident.type === "mail" && incident.mailKind === "inquiry_reply" && (incident.terminal || incident.errorClass === "final")) {
          add({ id: incident.id, kind: "inquiry_failed", type: incident.type, since: incident.openedAt, affectedCount: incident.affectedCount, ...(incident.inquiryId ? { inquiryId: incident.inquiryId } : {}) });
          continue;
        }
        if (incident.type === "mail") {
          const near = incident.bookingStart ? Date.parse(incident.bookingStart) - at <= config().ownerNearVisitHours * 3600000 && Date.parse(incident.bookingStart) > at : false;
          if (near || ageMinutes(incident.openedAt, at) >= config().ownerMailDelayMinutes)
            add({ id: incident.id, kind: "mail_delay", type: incident.type, since: incident.openedAt, affectedCount: incident.affectedCount });
          continue;
        }
        if (ageMinutes(incident.openedAt, at) >= config().driveFailureMinutes)
          add({ id: incident.id, kind: "drive_delay", type: incident.type, since: incident.openedAt, affectedCount: incident.affectedCount });
      }
      const order: OwnerIntegrationAlert["kind"][] = ["reconnect", "inquiry_failed", "mail_delay", "drive_delay"];
      return order.flatMap(kind => byKind.get(kind) ? [byKind.get(kind)!] : []);
    });
  }

  return {
    config,
    classify: classifyIntegrationError,
    incidents,
    openIncidents,
    recordFailure,
    recordBlocked,
    recordAuthStop,
    recordSuccess,
    recordObsolete,
    sweepShop,
    processOutbox,
    endArchived,
    ownerAlerts: (shop: Shop) => ownerAlertsFor(shop, now()),
    refreshIncident,
    closeIncident,
    formatWebhookPayload,
  };
}
