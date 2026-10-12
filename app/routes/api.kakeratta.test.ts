import assert from "node:assert/strict";
import test from "node:test";
import { action } from "./api.kakeratta";
import { setTokens, commitSession } from "~/services/session.server";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";
import { KakerattaSettingsSchema } from "~/types/kakeratta";
import { SETTINGS_FILE_NAME } from "~/services/sync-diff";

test("personal Vertex RAG is rejected before contacting or claiming Kakeratta asks", async t => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  const settings = { ...DEFAULT_USER_SETTINGS, usePersonalVertex: true, kakeratta: KakerattaSettingsSchema.parse({ enabled: true, url: "https://kakeratta.example/mcp", personas: { one: { ragSetting: "research" } } }) };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.href);
    assert.equal(url.hostname, "www.googleapis.com", "No MCP/AI request may occur before validation");
    if (url.pathname === "/drive/v3/files") return Response.json({ files: [{ id: "rag-settings", name: SETTINGS_FILE_NAME }] });
    if (url.pathname === "/drive/v3/files/rag-settings") return Response.json(settings);
    throw new Error("Unexpected request");
  };
  const empty = new Request("https://gemihub.example/api/kakeratta");
  const session = await setTokens(empty, { accessToken: "test-access", refreshToken: "test-refresh", expiryTime: Date.now() + 3_600_000, rootFolderId: "rag-preflight-root", email: "member@example.com" });
  const request = new Request(empty.url, { method: "POST", headers: { Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify({ operation: "poll" }) });
  const response = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /RAG is unavailable/);
  assert.equal(calls.length, 2);

  // The save action must reject the same combination before writing Drive
  // settings or registering server-side credentials.
  const { action: saveSettingsAction } = await import("./settings");
  const saveRequest = new Request("https://gemihub.example/settings", {
    method: "POST",
    headers: { Cookie: request.headers.get("Cookie")! },
    body: new URLSearchParams({ _action: "saveKakeratta", kakeratta: JSON.stringify(settings.kakeratta) }),
  });
  const saveResponse = await saveSettingsAction({ request: saveRequest, params: {}, context: {} } as Parameters<typeof saveSettingsAction>[0]);
  assert.equal(saveResponse.status, 400);
  assert.match((await saveResponse.json()).message, /RAG is unavailable/);
  assert.equal(calls.length, 2, "Saving must not write unsupported profiles or credentials");
});
