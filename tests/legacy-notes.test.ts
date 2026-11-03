import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { readFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import vm from "node:vm";
import { renderLegal } from "../server/legal.ts";
import { requestLocale } from "../server/i18n.ts";
import { hasLegacyNotes, isLegacyNotesSettings } from "../server/legacy-notes.ts";
import { createApp } from "../server/app.ts";
import { Store, type User, type Shop } from "../server/store.ts";
import { sample } from "../server/domain.ts";
import { digest } from "../server/auth.ts";

const settings = { apiPlan: "free", mcpServers: [], encryption: { publicKey: "pub", encryptedPrivateKey: "cipher", salt: "salt" } };

test("legacy detection requires the old note schema, not just a settings filename", async () => {
  assert.equal(isLegacyNotesSettings(settings), true);
  for (const value of [null, [], { theme: "dark" }, { ...settings, encryption: {} }]) assert.equal(isLegacyNotesSettings(value), false);
  const requests: string[] = [];
  const fake: typeof fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer access");
    requests.push(String(input));
    const url = new URL(String(input));
    if (url.searchParams.has("q")) {
      assert.ok(url.searchParams.get("q")!.includes("trashed = false"));
      return url.searchParams.has("pageToken") ? Response.json({ files: [{ id: "notes" }] }) : Response.json({ files: [{ id: "other" }], nextPageToken: "next" });
    }
    return Response.json(url.pathname.endsWith("notes") ? settings : { theme: "dark" });
  };
  assert.equal(await hasLegacyNotes("access", fake), true);
  assert.equal(requests.length, 4);
  await assert.rejects(hasLegacyNotes("access", async () => new Response(null, { status: 403 })));
  assert.equal(await hasLegacyNotes("access", async () => Response.json({ files: [] })), false);
});

test("old note owners must migrate before creating or managing a shop; completion is rechecked server-side", async t => {
  const shell = '<!doctype html><html><body><div id="root"></div></body></html>';
  const shellRead = t.mock.method(fs, "readFile", async () => Buffer.from(shell));
  syncBuiltinESMExports();
  t.after(() => { shellRead.mock.restore(); syncBuiltinESMExports(); });
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.DEMO_MODE = "true";
  let email = "notes@example.com", pending = true, checks = 0;
  const prototype = google.auth.OAuth2.prototype as unknown as {
    getToken: (...args: unknown[]) => Promise<unknown>;
    verifyIdToken: (...args: unknown[]) => Promise<unknown>;
    getAccessToken: (...args: unknown[]) => Promise<unknown>;
  };
  t.mock.method(prototype, "getToken", async () => ({ tokens: { id_token: "id", access_token: "access", refresh_token: "refresh", scope: "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.freebusy" } }));
  t.mock.method(prototype, "verifyIdToken", async () => ({ getPayload: () => ({ email_verified: true, email, name: "Owner" }) }));
  t.mock.method(prototype, "getAccessToken", async () => ({ token: "access" }));
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "www.googleapis.com") return originalFetch(input, init);
    assert.equal(init?.method ?? "GET", "GET");
    checks++;
    return url.searchParams.has("q") ? Response.json({ files: pending ? [{ id: "old-settings" }] : [] }) : Response.json(settings);
  });
  const store = new Store(":memory:");
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => { server.close(); await store.close(); });
  async function signIn(suffix = "") {
    const start = await originalFetch(base + "/auth/google" + suffix, { redirect: "manual" });
    const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
    return originalFetch(base + `/auth/google/callback?code=code&state=${state}`, { redirect: "manual", headers: { Cookie: start.headers.get("Set-Cookie")!.split(";")[0] } });
  }
  const login = await signIn();
  assert.equal(login.status, 302);
  assert.equal(login.headers.get("Location"), "/settings/migration");
  let cookie = login.headers.get("Set-Cookie")!.split(";")[0];
  const call = (path: string, method = "GET", origin = base) => originalFetch(base + path, { method, headers: { Cookie: cookie, Origin: origin } });
  const guidance = await call(login.headers.get("Location")!);
  assert.equal(guidance.status, 200);
  assert.match(guidance.headers.get("Content-Type")!, /^text\/html/);
  assert.ok((await guidance.text()).includes('<div id="root"></div>'));
  const guidanceHead = await call("/settings/migration?lang=en", "HEAD");
  assert.equal(guidanceHead.status, 200);
  assert.equal(await guidanceHead.text(), "");
  assert.equal((await call("/settings/unknown")).status, 404);
  assert.equal((await store.list("shop")).length, 0);
  const session = await (await call("/api/session")).json() as { user: Record<string, unknown> };
  assert.equal(session.user.legacyNotes, true);
  assert.equal(session.user.refreshToken, undefined);
  assert.equal((await call("/api/workspace")).status, 409);
  assert.equal((await call("/api/legacy-notes/check", "POST", "https://evil.example")).status, 403);
  assert.equal((await call("/api/legacy-notes/check", "POST")).status, 409);
  assert.equal((await store.list("shop")).length, 0);
  pending = false;
  const completed = await call("/api/legacy-notes/check", "POST");
  assert.equal(completed.status, 200);
  cookie = completed.headers.get("Set-Cookie")!.split(";")[0];
  assert.equal((await store.list("shop")).length, 1);
  assert.equal((await store.get<User>("user", email))?.legacyNotes, false);
  assert.equal((await call("/api/legacy-notes/check", "POST")).status, 200);
  assert.equal((await store.list("shop")).length, 1);
  // Returning after migration follows normal onboarding, without another notice.
  assert.equal((await signIn()).headers.get("Location"), "/");
  // Customer sign-in skips the legacy detector entirely.
  const shop = (await store.list<Shop>("shop"))[0];
  shop.published = structuredClone(sample); await store.saveShop(shop);
  email = "customer@example.com";
  const before = checks;
  const customer = await signIn(`?shop=${shop.slug}`);
  assert.equal(customer.status, 302);
  assert.equal(checks, before);
  const customerCookie = customer.headers.get("Set-Cookie")!.split(";")[0];
  assert.equal((await originalFetch(base + "/api/legacy-notes/check", { method: "POST", headers: { Cookie: customerCookie, Origin: base } })).status, 403);
});


test("the domain handover retires only old note shell caches and never touches IndexedDB", async () => {
  const listeners = new Map<string, (event?: unknown) => void>();
  const deleted: string[] = []; let claimed = false, unregistered = false, skipped = false;
  let activation: Promise<unknown> | undefined;
  const context = {
    self: { addEventListener: (name: string, fn: (event?: unknown) => void) => listeners.set(name, fn),
      skipWaiting: () => { skipped = true; }, clients: { claim: async () => { claimed = true; } },
      registration: { unregister: async () => { unregistered = true; } } },
    caches: { keys: async () => ["gemihub-sw-v1", "gemihub-sw-v0", "other-app-cache"], delete: async (key: string) => { deleted.push(key); } },
    get indexedDB() { throw new Error("Local notes must never be deleted"); },
  };
  vm.runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  listeners.get("install")!();
  listeners.get("activate")!({ waitUntil: (promise: Promise<unknown>) => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ["gemihub-sw-v1", "gemihub-sw-v0"]);
  assert.equal(claimed && unregistered && skipped, true);
});


test("public OAuth policy and terms retain their old URLs with current shop data use and no login requirement", async () => {
  const ja = requestLocale.run("ja", () => renderLegal("policy"));
  const en = requestLocale.run("en", () => renderLegal("policy"));
  assert.ok(ja.includes("Gmail") && ja.includes("Firestore") && ja.includes("プライバシーポリシー"));
  assert.ok(en.includes("Privacy policy") && en.includes("PayPal") && en.includes("Limited Use"));
  assert.ok(!en.includes("プライバシーポリシー"));
  assert.ok(requestLocale.run("en", () => renderLegal("terms")).includes("Terms of use"));
});
