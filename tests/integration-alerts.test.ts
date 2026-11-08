import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample, dateJST } from "../server/domain.ts";
import { encrypt } from "../server/google.ts";
import { Store, type Shop } from "../server/store.ts";
import {
  integrationAlerts,
  classifyIntegrationError,
  formatWebhookPayload,
  type IntegrationIncident,
  type IntegrationJob,
  type IntegrationPayload,
  type NotificationOutboxItem,
} from "../server/integration-alerts.ts";

const start = Date.parse("2026-11-08T00:00:00Z");
const iso = (value: number) => new Date(value).toISOString();

async function setup(overrides: { env?: Record<string, string>; send?: (url: string, body: string, headers: Record<string, string>) => Promise<void> } = {}) {
  const store = new Store(":memory:");
  const base = await store.createShop("owner@example.com");
  const shop: Shop = { ...base, published: structuredClone(sample), google: { folderId: "folder", specId: "spec", historyId: "history" } };
  await store.saveShop(shop);
  let now = start;
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  const alerts = integrationAlerts({
    store,
    now: () => now,
    env: {
      OPS_WEBHOOK_URL: "https://ops.example.test/hook",
      OPS_WEBHOOK_FORMAT: "generic",
      OPS_MAIL_FAILURE_MINUTES: "5",
      OPS_DRIVE_FAILURE_MINUTES: "15",
      OPS_FAILURE_COUNT: "3",
      OPS_SUMMARY_HOURS: "6",
      OPS_OWNER_MAIL_DELAY_MINUTES: "30",
      OPS_OWNER_NEAR_VISIT_HOURS: "2",
      ...overrides.env,
    } as NodeJS.ProcessEnv,
    send: overrides.send || (async (url, body, headers) => { sent.push({ url, body, headers }); }),
    log: () => {},
  });
  const advance = (ms: number) => { now += ms; };
  const job = (value: Partial<IntegrationJob> = {}): IntegrationJob => ({
    id: "job-1", shopId: shop.id, type: "mail", attempts: 0, createdAt: iso(now), mailKind: "booking_confirmation", ...value,
  });
  const failures = () => store.list<IntegrationIncident>("integrationIncident");
  const outbox = () => store.list<NotificationOutboxItem>("notificationOutbox");
  return { store, shop, alerts, advance, sent, job, failures, outbox, now: () => now };
}

test("403 is classified by reason instead of always asking the owner to reconnect", () => {
  assert.deepEqual(classifyIntegrationError({ status: 403, errors: [{ reason: "rateLimitExceeded" }] }), { errorClass: "transient", errorCode: "rate_limit_exceeded" });
  assert.deepEqual(classifyIntegrationError({ status: 403, errors: [{ reason: "userRateLimitExceeded" }] }), { errorClass: "transient", errorCode: "user_rate_limit_exceeded" });
  assert.deepEqual(classifyIntegrationError({ status: 403, errors: [{ reason: "insufficientPermissions" }] }), { errorClass: "auth", errorCode: "insufficient_permissions" });
  assert.deepEqual(classifyIntegrationError({ status: 403, errors: [{ reason: "serviceDisabled" }] }), { errorClass: "config", errorCode: "service_disabled" });
  assert.deepEqual(classifyIntegrationError({ status: 403 }), { errorClass: "unknown", errorCode: "HTTP_403" });
  assert.deepEqual(classifyIntegrationError({ status: 401 }), { errorClass: "auth", errorCode: "HTTP_401" });
  assert.deepEqual(classifyIntegrationError({ status: 401, errors: [{ reason: "invalid_grant" }] }), { errorClass: "auth", errorCode: "invalid_grant" });
  assert.deepEqual(classifyIntegrationError({ status: 429 }), { errorClass: "transient", errorCode: "HTTP_429" });
  assert.deepEqual(classifyIntegrationError({ status: 503 }), { errorClass: "transient", errorCode: "HTTP_503" });
  assert.deepEqual(classifyIntegrationError(new Error("unexpected")), { errorClass: "unknown", errorCode: "UNKNOWN" });
});

test("a transient failure below the threshold stays private, then opens once and summarizes every six hours", async () => {
  const { alerts, advance, sent, shop, job, failures, outbox, now } = await setup();
  const value = job({ firstFailedAt: iso(now()) });
  await alerts.recordFailure({ shop, job: value, error: { status: 503 }, firstFailure: true });
  assert.deepEqual(await outbox(), [], "no notification before the time and count thresholds");

  advance(5 * 60000);
  await alerts.recordFailure({ shop, job: value, error: { status: 503 }, firstFailure: false });
  await alerts.recordFailure({ shop, job: value, error: { status: 503 }, firstFailure: false });
  await alerts.processOutbox();
  assert.equal(sent.length, 1, "one opened notification");
  const opened = JSON.parse(sent[0].body) as IntegrationPayload;
  assert.equal(opened.event, "opened");
  assert.equal(opened.errorClass, "transient");
  assert.equal(opened.failureCount, 3);
  assert.equal(opened.affectedCount, 1);
  assert.match(sent[0].headers["Idempotency-Key"], /:opened:1$/);

  await alerts.processOutbox();
  assert.equal(sent.length, 1, "the same opened notification is not sent again");

  advance(6 * 3600000);
  const incident = (await failures())[0];
  await alerts.refreshIncident(incident);
  await alerts.processOutbox();
  assert.equal(sent.length, 2, "one six-hour summary");
  assert.equal((JSON.parse(sent[1].body) as IntegrationPayload).event, "summary");
});

test("a transient failure that recovers below the threshold notifies nobody", async () => {
  const { alerts, shop, job, failures, outbox } = await setup();
  const value = job();
  const result = await alerts.recordFailure({ shop, job: value, error: { status: 503 }, firstFailure: true });
  await alerts.recordSuccess({
    shop,
    job: { ...value, incidentId: result.incident.id, lastErrorClass: result.errorClass, lastErrorCode: result.errorCode, terminalReason: "sent" },
  });
  assert.deepEqual(await outbox(), []);
  assert.equal((await failures())[0].status, "resolved");
  assert.equal((await failures())[0].firstNotifiedAt, undefined);
});

test("the same failure after recovery creates a new generation and notifies again", async () => {
  const { alerts, advance, sent, shop, job, failures } = await setup();
  await alerts.recordBlocked({ shop, type: "mail", mailKind: "booking_confirmation" });
  await alerts.processOutbox();
  assert.equal(sent.length, 1);

  await alerts.recordSuccess({ shop, job: job({ id: "recovered" }) });
  await alerts.processOutbox();
  assert.equal(sent.length, 2, "recovery is sent once after an opened notification");
  assert.equal((JSON.parse(sent[1].body) as IntegrationPayload).event, "recovered");

  advance(2 * 3600000);
  await alerts.recordBlocked({ shop, type: "mail", mailKind: "booking_confirmation" });
  await alerts.processOutbox();
  const incidents = await failures();
  assert.equal(incidents.length, 2, "the recurrence is a new incident");
  assert.notEqual(incidents[0].id, incidents[1].id);
  assert.equal(sent.length, 3);
  assert.equal((JSON.parse(sent[2].body) as IntegrationPayload).event, "opened");
});

test("a stopped webhook keeps the outbox pending with backoff and does not fail the incident", async () => {
  let fail = true;
  const { store, alerts, advance, shop, job, outbox } = await setup({
    send: async () => { if (fail) throw Object.assign(new Error("webhook down"), { status: 503 }); },
  });
  await alerts.recordFailure({ shop, job: job(), error: { status: 401, errors: [{ reason: "invalid_grant" }] }, firstFailure: true });
  await alerts.processOutbox();
  const [pending] = await outbox();
  assert.equal(pending.status, "pending");
  assert.equal(pending.attempts, 1);
  assert.ok(Date.parse(pending.nextAt) > Date.parse(pending.createdAt));

  fail = false;
  advance(60000);
  await alerts.processOutbox();
  const [sent] = await store.list<NotificationOutboxItem>("notificationOutbox");
  assert.equal(sent.status, "sent");
});

test("developer notifications never carry recipient, body, customer, token or raw exception text", async () => {
  const { alerts, shop, job, outbox } = await setup();
  const value = job({
    id: "private-job",
    bookingId: "booking-1",
    inquiryId: "inquiry-1",
  }) as IntegrationJob & Record<string, unknown>;
  value.to = "customer@example.com";
  value.body = "secret message body";
  value.attachment = "private.pdf";
  await alerts.recordFailure({
    shop,
    job: value,
    error: Object.assign(new Error("invalid_grant for customer@example.com token=super-secret"), { status: 401 }),
    final: true,
    firstFailure: true,
  });
  const [entry] = await outbox();
  const payload = JSON.stringify(entry.payload);
  for (const forbidden of ["customer@example.com", "secret message body", "private.pdf", "super-secret", "invalid_grant for"]) {
    assert.ok(!payload.includes(forbidden), `payload leaked ${forbidden}`);
  }
  assert.ok(payload.includes("booking-1") === false, "booking IDs are not sent unless needed");
});

test("owner alerts separate reconnect from delayed mail and only show Drive delay on the dashboard", async () => {
  const mail = await setup();
  await mail.alerts.recordFailure({ shop: mail.shop, job: mail.job(), error: { status: 403, errors: [{ reason: "serviceDisabled" }] }, firstFailure: true });
  assert.deepEqual(await mail.alerts.ownerAlerts(mail.shop), [], "a 403 policy error does not ask for reconnect");
  mail.advance(30 * 60000);
  const mailAlert = (await mail.alerts.ownerAlerts(mail.shop))[0];
  assert.equal(mailAlert.kind, "mail_delay");
  assert.equal(mailAlert.affectedCount, 1);

  const auth = await setup();
  await auth.alerts.recordFailure({ shop: auth.shop, job: auth.job(), error: { status: 401 }, firstFailure: true });
  assert.equal((await auth.alerts.ownerAlerts(auth.shop))[0].kind, "reconnect");

  const reply = await setup();
  await reply.alerts.recordFailure({
    shop: reply.shop,
    job: reply.job({ mailKind: "inquiry_reply", inquiryId: "inquiry-1" }),
    error: { status: 400 },
    final: true,
    firstFailure: true,
  });
  const replyAlert = (await reply.alerts.ownerAlerts(reply.shop))[0];
  assert.equal(replyAlert.kind, "inquiry_failed");
  assert.equal(replyAlert.inquiryId, "inquiry-1");

  const drive = await setup();
  await drive.alerts.recordFailure({ shop: drive.shop, job: drive.job({ type: "posts" }), error: { status: 503 }, firstFailure: true });
  assert.deepEqual(await drive.alerts.ownerAlerts(drive.shop), []);
  drive.advance(15 * 60000);
  assert.equal((await drive.alerts.ownerAlerts(drive.shop))[0].kind, "drive_delay");
});

test("a stalled job and a missing token are detected without incrementing job attempts", async () => {
  const stalled = await setup();
  const value = stalled.job({ lastAttemptAt: iso(stalled.now()) });
  await stalled.store.put("job", value.id, value);
  stalled.advance(6 * 60000);
  await stalled.alerts.sweepShop(stalled.shop, { hasToken: true });
  const [incident] = await stalled.failures();
  assert.equal(incident.errorClass, "transient");
  assert.equal(incident.stalled, true);
  assert.equal(incident.firstNotifiedAt !== undefined, true);
  assert.equal((await stalled.store.get<IntegrationJob>("job", value.id))?.attempts, 0);

  const missing = await setup();
  const waiting = missing.job({ lastAttemptAt: iso(missing.now()) });
  await missing.store.put("job", waiting.id, waiting);
  await missing.alerts.sweepShop(missing.shop, { hasToken: false });
  const [auth] = await missing.failures();
  assert.equal(auth.errorClass, "auth");
  assert.equal(auth.errorCode, "TOKEN_MISSING");
  assert.equal((await missing.alerts.ownerAlerts(missing.shop))[0].kind, "reconnect");
});

test("an unknown webhook format is not posted blindly", async () => {
  const { alerts, sent, shop, job, outbox } = await setup({ env: { OPS_WEBHOOK_FORMAT: "teams" } });
  await alerts.recordFailure({ shop, job: job(), error: { status: 401 }, firstFailure: true });
  await alerts.processOutbox();
  assert.equal(sent.length, 0);
  const [pending] = await outbox();
  assert.equal(pending.status, "pending");
  assert.equal(pending.lastErrorCode, "INVALID_FORMAT");
});

test("webhook formats match the destination instead of posting the canonical payload", () => {
  const payload: IntegrationPayload = {
    environment: "production", shopId: "shop-1", incidentId: "shop-1:mail:transient:1", event: "opened",
    type: "mail", mailKind: "booking_confirmation", errorClass: "transient", errorCode: "HTTP_503",
    openedAt: "2026-11-08T00:00:00.000Z", occurredAt: "2026-11-08T00:06:00.000Z", durationMinutes: 6,
    affectedCount: 2, failureCount: 3, retryState: "automatic retry", link: "https://gemihub.net/?shop=shop-1",
  };
  const generic = formatWebhookPayload("generic", payload) as IntegrationPayload;
  assert.equal(generic.incidentId, payload.incidentId);
  const slack = formatWebhookPayload("slack", payload) as { text: string; blocks: { type: string }[] };
  assert.match(slack.text, /incident=shop-1:mail:transient:1/);
  assert.ok(slack.blocks.some(block => block.type === "section"));
  const chat = formatWebhookPayload("google_chat", payload) as { text: string };
  assert.match(chat.text, /affected=2/);
});

test("archiving a shop ends its open incidents without reporting recovery", async () => {
  const { store, alerts, advance, sent, shop, job } = await setup();
  await alerts.recordFailure({ shop, job: job(), error: { status: 401 }, firstFailure: true });
  await alerts.processOutbox();
  assert.equal(sent.length, 1);
  await store.saveShop({ ...shop, archivedAt: iso(start) });
  advance(60000);
  await alerts.endArchived(await store.list<Shop>("shop"));
  const [incident] = await store.list<IntegrationIncident>("integrationIncident");
  assert.equal(incident.status, "ended");
  assert.equal(incident.resolution, "archived");
  await alerts.processOutbox();
  assert.equal(sent.length, 2);
  assert.equal((JSON.parse(sent[1].body) as IntegrationPayload).event, "ended");
});

test("flushJobs records safe failure metadata and resolves the incident after a real success", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.published.hours.closedWeekdays = [];
  shop.published.notificationEmail = "OWNER@example.com";
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  await store.put("user", shop.owner, { email: shop.owner, name: "Owner", role: "owner", refreshToken: encrypt("owner-refresh") });
  const email = "customer@example.com";
  await store.put("session", digest("customer"), { user: { email, name: "Customer", role: "customer", shopId: shop.id, authMethod: "email" }, expires: Date.now() + 600000 });
  await store.put("customer", `${shop.id}:${email}`, { shopId: shop.id, email, name: "Customer", birthDate: "1990-01-01", gender: "not_specified" });
  let failing = true;
  t.mock.method(google, "gmail", (() => ({ users: { messages: { async send() { if (failing) throw Object.assign(new Error("temporary"), { status: 503 }); } } } })) as never);
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const call = async (path: string, data?: unknown) => {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: "gemihub_session=customer", "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const base = `/api/public/${shop.slug}`;
  const nextInput = async () => {
    const date = dateJST(new Date(Date.now() + 4 * 86400000));
    const slots = await call(`${base}/slots?date=${date}&menu=simple&staff=aoi`);
    assert.ok(slots.length);
    return { name: "Customer", menuId: "simple", staffId: "aoi", start: slots[0].start, requestId: randomUUID() };
  };
  const first = await call(`${base}/bookings`, await nextInput());
  const [job] = await store.list<IntegrationJob>("job");
  assert.equal(job.mailKind, "booking_confirmation");
  assert.equal(job.bookingId, first.booking.id);
  assert.ok(job.firstFailedAt && job.lastAttemptAt);
  assert.equal(job.lastErrorClass, "transient");
  assert.equal(job.lastErrorCode, "HTTP_503");
  assert.ok(job.incidentId);
  const [incident] = await store.list<IntegrationIncident>("integrationIncident");
  assert.equal(incident.errorClass, "transient");
  assert.equal(incident.affectedCount, 1);
  assert.equal(incident.firstNotifiedAt, undefined, "below the threshold, the owner and developer see nothing");

  failing = false;
  await call(`${base}/bookings`, await nextInput());
  assert.equal((await store.list("job")).length, 0);
  const [resolved] = await store.list<IntegrationIncident>("integrationIncident");
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolution, "succeeded");
  assert.ok(resolved.lastSuccessAt);
});
