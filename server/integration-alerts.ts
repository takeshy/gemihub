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
  /** Every incident this job has contributed to; its error class can change between attempts. */
  incidentIds?: string[];
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
  resolution?: "succeeded" | "obsolete" | "unavailable" | "archived" | "expired";
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
  finalAlertDays: number;
  retentionDays: number;
};

/** Runs `fn` under the lock that the delivery worker holds while it sends and deletes jobs of `type`. */
export type JobLock = <T>(type: IntegrationType, fn: () => Promise<T>) => Promise<T>;

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
/** An incident spanning several bookings keeps the visit that comes first, so a nearer customer is never hidden. */
function nearestStart(current: string | undefined, next: string | undefined, now: number) {
  const upcoming = [current, next].filter((value): value is string => !!value && Date.parse(value) > now);
  if (upcoming.length) return upcoming.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return next || current;
}
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
    finalAlertDays: numberEnv(env, "OPS_FINAL_ALERT_DAYS", 7),
    retentionDays: numberEnv(env, "OPS_INCIDENT_RETENTION_DAYS", 30),
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
    // OAuth token endpoints answer `{ error: "invalid_grant" }`; Google APIs answer `{ error: { errors: [...] } }`.
    response?: { status?: unknown; data?: { error?: string | { status?: unknown; errors?: { reason?: unknown }[] } } };
    cause?: { status?: unknown; reason?: unknown };
  } | null;
  const status = Number(
    value?.status ??
    (typeof value?.code === "number" ? value.code : undefined) ??
    value?.response?.status ??
    value?.cause?.status,
  ) || undefined;
  const apiError = value?.response?.data?.error;
  const reason = normalizeReason(
    safeCode(value?.errors?.[0]?.reason) ||
    (typeof apiError === "object" ? safeCode(apiError?.errors?.[0]?.reason) : safeCode(apiError)) ||
    safeCode(value?.cause?.reason) ||
    safeCode(value?.reason) ||
    (typeof value?.code === "string" && !/^\d+$/.test(value.code) ? safeCode(value.code) : undefined) ||
    (typeof apiError === "object" ? safeCode(apiError?.status) : undefined),
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
  // A revoked grant arrives as HTTP 400 from the token endpoint: the owner must reconnect, whatever the status.
  if (reason && AUTH_REASONS.has(reason)) return { errorClass: "auth", errorCode };
  if ((error as { name?: string } | null)?.name === "ZodError" || status === 400 || status === 422)
    return { errorClass: "config", errorCode };
  if (status === 401) return { errorClass: "auth", errorCode };
  if (status === 403) {
    if (reason && RATE_REASONS.has(reason)) return { errorClass: "transient", errorCode };
    if (reason && CONFIG_REASONS.has(reason)) return { errorClass: "config", errorCode };
    return { errorClass: "unknown", errorCode };
  }
  if (status === 429 || (status !== undefined && status >= 500))
    return { errorClass: "transient", errorCode };
  if (reason && RATE_REASONS.has(reason)) return { errorClass: "transient", errorCode };
  if (reason && CONFIG_REASONS.has(reason)) return { errorClass: "config", errorCode };
  return { errorClass: "unknown", errorCode };
}

const jobType = (job: IntegrationJob): IntegrationType => job.type === "posts" ? "drive" : "mail";
/** Whether this job has already been counted in the incident's affected messages. */
const jobLinked = (job: IntegrationJob, incidentId: string) => job.incidentId === incidentId || !!job.incidentIds?.includes(incidentId);
/** A message that will never be sent is its own incident, so separate inquiries never overwrite each other. */
const finalTarget = (job: IntegrationJob) => job.inquiryId ? `${safeCode(job.mailKind) || "mail"}:${job.inquiryId}` : `job:${job.id}`;
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
    /** The failing job. Without one (a discarded intent), every call is a new affected message. */
    job?: IntegrationJob;
    /** Final failures are keyed per lost message instead of shared by the whole shop. */
    target?: string;
  }) {
    const shared = incidentBaseKey(input.shop.id, input.type, input.errorClass);
    const baseKey = input.target ? `${shared}:${input.target}` : shared;
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
          affectedCount: existing.affectedCount + (input.job && jobLinked(input.job, existing.id) ? 0 : 1),
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          ...(input.mailKind ? { mailKind: input.mailKind } : {}),
          ...(input.inquiryId ? { inquiryId: input.inquiryId } : {}),
          ...(input.stalled ? { stalled: true } : {}),
          ...(input.terminal ? { terminal: true } : {}),
        };
        const bookingStart = nearestStart(existing.bookingStart, input.bookingStart, now());
        if (bookingStart && bookingStart !== existing.bookingStart) {
          updated.bookingStart = bookingStart;
          if (input.bookingId) updated.bookingId = input.bookingId; else delete updated.bookingId;
        }
        await store.put("integrationIncident", updated.id, updated);
        return updated;
      }
      // Per-message keys would leave one sequence document per message behind; a timestamp is unique under this lock.
      const generation = input.target ? now() : await nextGeneration(baseKey);
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
        affectedCount: 1,
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

  /**
   * Notification state is written from a fresh read under the incident lock: a caller's copy may be
   * older than a recovery that closed the incident, and writing it back would reopen it.
   */
  function withOpenIncident(incident: IntegrationIncident, update: (current: IntegrationIncident) => Promise<IntegrationIncident>) {
    return store.locked(`integration:${incident.baseKey}`, async () => {
      const current = await store.get<IntegrationIncident>("integrationIncident", incident.id);
      if (!current || !openStatus(current)) return current || incident;
      return update(current);
    });
  }

  const notifyOpened = (incident: IntegrationIncident) => withOpenIncident(incident, openedNotice);

  async function openedNotice(incident: IntegrationIncident) {
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
    return withOpenIncident(incident, summaryNotice);
  }

  async function summaryNotice(incident: IntegrationIncident) {
    let current = incident;
    if (!current.firstNotifiedAt) current = await openedNotice(current);
    // Nothing retries a final failure, so a periodic summary would only repeat the opened notice.
    if (current.errorClass === "final") return current;
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

  async function closeIncident(incident: IntegrationIncident, resolution: NonNullable<IntegrationIncident["resolution"]>, notify = true) {
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
      if (notify && current.firstNotifiedAt) await enqueueOutbox(updated, resolution === "succeeded" ? "recovered" : "ended", 1);
      return updated;
    });
  }

  function matchesJob(incident: IntegrationIncident, job: IntegrationJob) {
    if (job.incidentId === incident.id || job.incidentIds?.includes(incident.id)) return true;
    if (job.lastErrorClass === incident.errorClass) return true;
    return incident.errorClass === "auth";
  }

  /** Reads only this shop's jobs: this runs after every delivered message. */
  const shopJobs = async (shop: Shop) => (await store.entries<IntegrationJob>("job", shop)).map(entry => entry.value);

  async function remainingJobs(shop: Shop, type: IntegrationType, incident: IntegrationIncident, excludeJobId?: string) {
    return (await shopJobs(shop)).filter(job =>
      jobType(job) === type && job.id !== excludeJobId && matchesJob(incident, job));
  }

  async function recordFailure(input: { shop: Shop; job: IntegrationJob; error: unknown; final?: boolean; stalled?: boolean; openedAt?: string }) {
    const classified = classifyIntegrationError(input.error);
    const { errorCode } = classified;
    const type = jobType(input.job);
    const common = {
      shop: input.shop,
      type,
      errorCode,
      job: input.job,
      ...(input.job.mailKind ? { mailKind: input.job.mailKind } : {}),
      ...(input.job.bookingId ? { bookingId: input.job.bookingId } : {}),
      ...(input.job.bookingStart ? { bookingStart: input.job.bookingStart } : {}),
      ...(input.job.inquiryId ? { inquiryId: input.job.inquiryId } : {}),
    };
    const touched: string[] = [];
    let incident: IntegrationIncident;
    if (input.final) {
      // A revoked grant still needs the shared reconnect guidance; the lost message is tracked on its own.
      if (classified.errorClass === "auth") touched.push((await notifyOpened(await upsertIncident({ ...common, errorClass: "auth" }))).id);
      incident = await notifyOpened(await upsertIncident({ ...common, errorClass: "final", target: finalTarget(input.job), terminal: true }));
      touched.push(incident.id);
      // The job will not retry, so an earlier incident for the same job is finished, not recovered.
      for (const other of await openIncidents(input.shop)) {
        if (touched.includes(other.id) || other.errorClass === "final" || other.type !== type || !matchesJob(other, input.job)) continue;
        if (!(await remainingJobs(input.shop, type, other, input.job.id)).length)
          await closeIncident(other, "unavailable");
      }
    } else {
      incident = await notifyOpened(await upsertIncident({
        ...common,
        errorClass: classified.errorClass,
        ...(input.stalled ? { stalled: true } : {}),
        ...(input.openedAt ? { openedAt: input.openedAt } : {}),
      }));
    }
    const incidentIds = [...new Set([...(input.job.incidentIds || []), ...(input.job.incidentId ? [input.job.incidentId] : []), ...touched, incident.id])];
    return { incident, errorClass: incident.errorClass, errorCode, incidentIds };
  }

  /**
   * A stopped job counts once per incident: it is linked to the incident it joined, and is counted
   * again only when that incident has recovered and the same failure recurs as a new generation.
   */
  async function recordStop(shop: Shop, type: IntegrationType, errorCode: string, job?: IntegrationJob, mailKind = job?.mailKind) {
    const baseKey = incidentBaseKey(shop.id, type, "auth");
    if (job && (await openIncidents(shop)).some(incident => incident.baseKey === baseKey && jobLinked(job, incident.id))) return undefined;
    const incident = await upsertIncident({
      shop,
      type,
      errorClass: "auth",
      errorCode,
      ...(job ? { job } : {}),
      ...(mailKind ? { mailKind } : {}),
      ...(job?.bookingId ? { bookingId: job.bookingId } : {}),
      ...(job?.bookingStart ? { bookingStart: job.bookingStart } : {}),
      ...(job?.inquiryId ? { inquiryId: job.inquiryId } : {}),
    });
    return notifyOpened(incident);
  }

  /** Without a Google connection `enqueue` discards the message, so each call is one more lost message. */
  async function recordBlocked(input: { shop: Shop; type: IntegrationType; mailKind?: string; job?: IntegrationJob }) {
    if (input.shop.judge) return;
    return recordStop(input.shop, input.type, "GOOGLE_NOT_CONNECTED", input.job, input.mailKind);
  }

  async function recordAuthStop(shop: Shop, job: IntegrationJob, code: string) {
    return recordStop(shop, jobType(job), code, job);
  }

  async function recordSuccess(input: { shop: Shop; job: IntegrationJob }) {
    for (const incident of (await openIncidents(input.shop)).filter(item => item.type === jobType(input.job))) {
      if (incident.errorClass === "final") {
        // A lost message is answered when a later message of the same kind reaches that inquiry.
        if (input.job.inquiryId && incident.baseKey.endsWith(`:${finalTarget(input.job)}`)) await closeIncident(incident, "succeeded");
        continue;
      }
      if (!matchesJob(incident, input.job)) continue;
      if (!(await remainingJobs(input.shop, incident.type, incident, input.job.id)).length)
        await closeIncident(incident, "succeeded");
    }
  }

  async function recordObsolete(input: { shop: Shop; job: IntegrationJob }) {
    for (const incident of (await openIncidents(input.shop)).filter(item => item.type === jobType(input.job) && item.errorClass !== "final")) {
      if (!matchesJob(incident, input.job)) continue;
      if (!(await remainingJobs(input.shop, incident.type, incident, input.job.id)).length)
        await closeIncident(incident, "obsolete");
    }
  }

  /**
   * Each job type is inspected under the delivery worker's lock and re-read there. A job sent and
   * deleted meanwhile is gone, so a stale copy can neither be written back (and mailed again) nor
   * reopen an incident that its success just resolved.
   */
  async function sweepShop(shop: Shop, options: { hasToken: boolean; lock?: JobLock }) {
    const lock: JobLock = options.lock || ((_type, fn) => fn());
    const queued = await shopJobs(shop);
    for (const type of ["mail", "drive"] as const) {
      if (!queued.some(job => jobType(job) === type)) continue;
      await lock(type, async () => {
        // Post pages deliberately wait for an in-flight publish/restore; that wait is not a stalled sync.
        if (type === "drive" && (await store.shop(shop.id))?.publishingPlanId) return;
        const jobs = (await shopJobs(shop)).filter(job => jobType(job) === type);
        for (const job of jobs) await sweepJob(shop, job, options.hasToken);
      });
    }
    const at = now();
    for (const incident of await incidents(shop)) {
      if (!openStatus(incident)) {
        // Closed incidents are history only; dropping old ones bounds the reads made on every delivery.
        if (incident.resolvedAt && at - Date.parse(incident.resolvedAt) >= config().retentionDays * 86400000)
          await store.delete("integrationIncident", incident.id);
        continue;
      }
      // The owner has seen a lost message long enough; it ends quietly instead of staying on the dashboard.
      if (incident.errorClass === "final" && at - Date.parse(incident.lastFailureAt) >= config().finalAlertDays * 86400000)
        await closeIncident(incident, "expired", false);
      else await refreshIncident(incident);
    }
  }

  async function sweepJob(shop: Shop, job: IntegrationJob, hasToken: boolean) {
    const type = jobType(job);
    if (!shop.google || !hasToken) {
      const incident = shop.google ? await recordAuthStop(shop, job, "TOKEN_MISSING") : await recordBlocked({ shop, type, job });
      if (incident) await store.put("job", job.id, { ...job, incidentId: incident.id, incidentIds: [...new Set([...(job.incidentIds || []), incident.id])] });
      return;
    }
    const last = Date.parse(job.lastAttemptAt || job.firstFailedAt || job.createdAt || "");
    if (!Number.isFinite(last)) return;
    const minutes = type === "mail" ? config().mailStallMinutes : config().driveStallMinutes;
    if (now() - last < minutes * 60000) return;
    const error = Object.assign(new Error("stalled"), { status: 504, code: "JOB_STALLED" });
    const result = await recordFailure({ shop, job, error, stalled: true, openedAt: job.lastAttemptAt || job.firstFailedAt || job.createdAt });
    if (job.incidentId !== result.incident.id || !job.firstFailedAt || !job.incidentIds?.includes(result.incident.id))
      await store.put("job", job.id, {
        ...job,
        incidentId: result.incident.id,
        incidentIds: result.incidentIds,
        lastErrorClass: result.errorClass,
        lastErrorCode: result.errorCode,
        firstFailedAt: job.firstFailedAt || iso(now() - minutes * 60000),
      });
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
        // Other lost messages are not retrying, so "delayed, retrying automatically" would be untrue.
        if (incident.errorClass === "final") continue;
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
