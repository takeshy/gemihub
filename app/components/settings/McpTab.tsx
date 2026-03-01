import { useState, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "react-router";
import {
  Plus,
  Trash2,
  TestTube,
  ShieldCheck,
  KeyRound,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useI18n } from "~/i18n/context";
import { StatusBanner, SectionCard, Label, inputClass } from "~/components/settings/shared";
import type {
  UserSettings,
  McpServerConfig,
  OAuthConfig,
  OAuthTokens,
  McpToolInfo,
} from "~/types/settings";

interface McpFormEntry {
  name: string;
  url: string;
  headers: string; // JSON string
}

const emptyMcpEntry: McpFormEntry = { name: "", url: "", headers: "{}" };

// Redirect-fallback types for mobile OAuth (popup blocked)
interface PendingMcpOAuth {
  codeVerifier: string;
  state: string;
  redirectUri: string;
  oauthConfig: OAuthConfig;
  flowType: "add" | "testExisting" | "reauthorize";
  newEntry?: McpFormEntry;           // flowType === "add"
  serverIndex?: number;              // flowType !== "add"
  serverUrl?: string;                // identity check on return
  createdAt: number;
}
const MCP_OAUTH_PENDING_KEY = "mcp-oauth-pending";
const MCP_OAUTH_CALLBACK_KEY = "mcp-oauth-callback-result";

// PKCE utilities for OAuth flow

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function McpTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const { t } = useI18n();

  const [servers, setServers] = useState<McpServerConfig[]>(settings.mcpServers);
  const [adding, setAdding] = useState(false);
  const [newEntry, setNewEntry] = useState<McpFormEntry>({ ...emptyMcpEntry });
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string }>>({});
  const [addTestResult, setAddTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addTesting, setAddTesting] = useState(false);
  const [detailServer, setDetailServer] = useState<McpServerConfig | null>(null);

  // --- OAuth redirect-flow completion (mobile fallback) ---
  const oauthResumeRef = useRef(false);
  useEffect(() => {
    if (oauthResumeRef.current) return;

    const pendingRaw = sessionStorage.getItem(MCP_OAUTH_PENDING_KEY);
    const callbackRaw = sessionStorage.getItem(MCP_OAUTH_CALLBACK_KEY);
    if (!pendingRaw || !callbackRaw) return;

    // Mark as processing immediately to prevent double execution
    oauthResumeRef.current = true;
    sessionStorage.removeItem(MCP_OAUTH_PENDING_KEY);
    sessionStorage.removeItem(MCP_OAUTH_CALLBACK_KEY);

    let pending: PendingMcpOAuth;
    let callback: { code?: string; state?: string; error?: string; errorDescription?: string };
    try {
      pending = JSON.parse(pendingRaw);
      callback = JSON.parse(callbackRaw);
    } catch {
      return;
    }

    // Expiry check (10 minutes)
    if (Date.now() - pending.createdAt > 10 * 60 * 1000) return;

    // State verification
    if (callback.state !== pending.state) {
      setAddTestResult({ ok: false, msg: "OAuth state mismatch" });
      return;
    }

    if (callback.error) {
      setAddTestResult({ ok: false, msg: `OAuth failed: ${callback.errorDescription || callback.error}` });
      return;
    }

    const setError = (msg: string) => {
      if (pending.flowType === "add") {
        setAddTestResult({ ok: false, msg });
      } else if (pending.serverIndex != null) {
        setTestResults((r) => ({ ...r, [pending.serverIndex!]: { ok: false, msg } }));
      }
    };

    // Token exchange and flow completion
    (async () => {
      try {
        const tokenRes = await fetch("/api/settings/mcp-oauth-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenUrl: pending.oauthConfig.tokenUrl,
            clientId: pending.oauthConfig.clientId,
            clientSecret: pending.oauthConfig.clientSecret,
            code: callback.code,
            codeVerifier: pending.codeVerifier,
            redirectUri: pending.redirectUri,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.tokens) {
          setError(`Token exchange failed: ${tokenData.error || "unknown"}`);
          return;
        }
        const tokens = tokenData.tokens as OAuthTokens;

        if (pending.flowType === "add" && pending.newEntry) {
          // Complete add-server flow
          const entry = pending.newEntry;
          let headers: Record<string, string> = {};
          try { headers = JSON.parse(entry.headers); } catch { /* use empty */ }

          setAddTesting(true);
          setAdding(true);
          setAddTestResult({ ok: false, msg: "Retesting with OAuth tokens..." });

          const retryRes = await fetch("/api/settings/mcp-test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: entry.url.trim(),
              headers,
              oauth: pending.oauthConfig,
              oauthTokens: tokens,
              origin: window.location.origin,
            }),
          });
          const retryData = await retryRes.json();

          if (retryRes.ok && retryData.success) {
            const newServer: McpServerConfig = {
              name: entry.name.trim(),
              url: entry.url.trim(),
              headers,
              tools: retryData.tools as McpToolInfo[],
              oauth: pending.oauthConfig,
              oauthTokens: tokens,
            };
            const updated = [...servers, newServer];
            setServers(updated);
            const fd = new FormData();
            fd.set("_action", "saveMcp");
            fd.set("mcpServers", JSON.stringify(updated));
            fetcher.submit(fd, { method: "post" });
            setNewEntry({ ...emptyMcpEntry });
            setAdding(false);
            setAddTestResult(null);
          } else {
            setAddTestResult({ ok: false, msg: retryData.message || "Connection failed after OAuth" });
          }
          setAddTesting(false);
        } else {
          // Complete testExisting / reauthorize flow
          const idx = pending.serverIndex;
          if (idx == null) return;
          if (idx >= servers.length) return;
          if (pending.serverUrl && servers[idx].url !== pending.serverUrl) return;

          // Update tokens on the server entry
          const updated = servers.map((s, i) =>
            i === idx ? { ...s, oauth: pending.oauthConfig, oauthTokens: tokens } : s
          );
          setServers(updated);
          const fd = new FormData();
          fd.set("_action", "saveMcp");
          fd.set("mcpServers", JSON.stringify(updated));
          fetcher.submit(fd, { method: "post" });

          if (pending.flowType === "reauthorize") {
            setTestResults((r) => ({ ...r, [idx]: { ok: true, msg: "Re-authorized successfully" } }));
          } else {
            // testExisting: retry the test
            setTestResults((r) => ({ ...r, [idx]: { ok: false, msg: "Retesting with OAuth tokens..." } }));
            try {
              const retryRes = await fetch("/api/settings/mcp-test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  url: servers[idx].url,
                  headers: servers[idx].headers,
                  oauth: pending.oauthConfig,
                  oauthTokens: tokens,
                  origin: window.location.origin,
                }),
              });
              const retryData = await retryRes.json();
              setTestResults((r) => ({
                ...r,
                [idx]: { ok: retryRes.ok, msg: retryData.message || (retryRes.ok ? "Connected" : "Failed") },
              }));
              if (retryRes.ok && retryData.tools) {
                setServers((p) => p.map((s, i) => i === idx ? { ...s, tools: retryData.tools as McpToolInfo[] } : s));
              }
            } catch (err) {
              setTestResults((r) => ({
                ...r,
                [idx]: { ok: false, msg: err instanceof Error ? err.message : "Network error" },
              }));
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "OAuth resume failed");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveServers = useCallback((updated: McpServerConfig[]) => {
    const fd = new FormData();
    fd.set("_action", "saveMcp");
    fd.set("mcpServers", JSON.stringify(updated));
    fetcher.submit(fd, { method: "post" });
  }, [fetcher]);

  const removeServer = useCallback((idx: number) => {
    const updated = servers.filter((_, i) => i !== idx);
    setServers(updated);
    setTestResults((prev) => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
    saveServers(updated);
  }, [servers, saveServers]);

  const startAddOAuthFlow = useCallback(async (
    oauthConfig: OAuthConfig,
    pendingNewEntry: McpFormEntry,
  ): Promise<OAuthTokens | null> => {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);
    const redirectUri = `${window.location.origin}/auth/mcp-oauth-callback`;

    const params = new URLSearchParams({
      response_type: "code",
      client_id: oauthConfig.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (oauthConfig.scopes.length > 0) {
      params.set("scope", oauthConfig.scopes.join(" "));
    }

    const authUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;

    setAddTestResult({ ok: false, msg: t("settings.mcp.oauthAuthenticating") });

    const popup = window.open(authUrl, "mcp-oauth", "width=600,height=700,popup=yes");

    // Redirect fallback when popup is blocked (common on mobile)
    if (!popup) {
      const pending: PendingMcpOAuth = {
        codeVerifier, state, redirectUri, oauthConfig,
        flowType: "add",
        newEntry: pendingNewEntry,
        createdAt: Date.now(),
      };
      sessionStorage.setItem(MCP_OAUTH_PENDING_KEY, JSON.stringify(pending));
      window.location.href = authUrl;
      return new Promise(() => {}); // page will navigate away
    }

    return new Promise((resolve) => {
      let resolved = false;

      const onMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== "mcp-oauth-callback") return;
        if (resolved) return;
        resolved = true;
        cleanup();

        if (event.data.error) {
          setAddTestResult({
            ok: false,
            msg: t("settings.mcp.oauthFailed").replace("{{error}}", event.data.errorDescription || event.data.error),
          });
          resolve(null);
          return;
        }

        if (event.data.state !== state) {
          setAddTestResult({ ok: false, msg: t("settings.mcp.oauthFailed").replace("{{error}}", "State mismatch") });
          resolve(null);
          return;
        }

        try {
          const tokenRes = await fetch("/api/settings/mcp-oauth-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tokenUrl: oauthConfig.tokenUrl,
              clientId: oauthConfig.clientId,
              clientSecret: oauthConfig.clientSecret,
              code: event.data.code,
              codeVerifier,
              redirectUri,
            }),
          });
          const tokenData = await tokenRes.json();
          if (!tokenRes.ok || !tokenData.tokens) {
            setAddTestResult({
              ok: false,
              msg: t("settings.mcp.oauthFailed").replace("{{error}}", tokenData.error || "Token exchange failed"),
            });
            resolve(null);
            return;
          }

          resolve(tokenData.tokens as OAuthTokens);
        } catch (err) {
          setAddTestResult({
            ok: false,
            msg: t("settings.mcp.oauthFailed").replace("{{error}}", err instanceof Error ? err.message : "Token exchange error"),
          });
          resolve(null);
        }
      };

      const onStorage = (event: StorageEvent) => {
        if (event.key !== "mcp-oauth-callback" || !event.newValue) return;
        try {
          const msg = JSON.parse(event.newValue);
          if (msg.type === "mcp-oauth-callback") {
            onMessage({ data: msg, origin: window.location.origin } as MessageEvent);
          }
        } catch { /* ignore parse errors */ }
      };

      window.addEventListener("message", onMessage);
      window.addEventListener("storage", onStorage);

      const checkClosedInterval = setInterval(() => {
        if (popup && popup.closed && !resolved) {
          resolved = true;
          cleanup();
          resolve(null);
        }
      }, 500);

      function cleanup() {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("storage", onStorage);
        clearInterval(checkClosedInterval);
      }
    });
  }, [t]);

  const testAndAddServer = useCallback(async () => {
    if (!newEntry.name.trim() || !newEntry.url.trim()) return;
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(newEntry.headers);
    } catch {
      // ignore parse error, use empty
    }

    setAddTesting(true);
    setAddTestResult({ ok: false, msg: "Testing..." });

    try {
      const res = await fetch("/api/settings/mcp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newEntry.url.trim(), headers, origin: window.location.origin }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const newServer: McpServerConfig = {
          name: newEntry.name.trim(),
          url: newEntry.url.trim(),
          headers,
          tools: data.tools as McpToolInfo[],
        };
        const updated = [...servers, newServer];
        setServers(updated);
        saveServers(updated);
        setNewEntry({ ...emptyMcpEntry });
        setAdding(false);
        setAddTestResult(null);
      } else if (data.needsOAuth && data.oauthDiscovery) {
        // Server requires OAuth — start OAuth flow for the new server
        const oauthConfig: OAuthConfig = data.oauthDiscovery.config;

        if (!oauthConfig.clientId) {
          setAddTestResult({ ok: false, msg: t("settings.mcp.oauthFailed").replace("{{error}}", "No client ID (registration failed)") });
          return;
        }

        const tokens = await startAddOAuthFlow(oauthConfig, newEntry);
        if (!tokens) return;

        setAddTestResult({ ok: false, msg: t("settings.mcp.oauthSuccess") + " Retesting..." });
        // Retry test with new tokens
        const retryRes = await fetch("/api/settings/mcp-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: newEntry.url.trim(),
            headers,
            oauth: oauthConfig,
            oauthTokens: tokens,
            origin: window.location.origin,
          }),
        });
        const retryData = await retryRes.json();

        if (retryRes.ok && retryData.success) {
          const newServer: McpServerConfig = {
            name: newEntry.name.trim(),
            url: newEntry.url.trim(),
            headers,
            tools: retryData.tools as McpToolInfo[],
            oauth: oauthConfig,
            oauthTokens: tokens,
          };
          const updated = [...servers, newServer];
          setServers(updated);
          saveServers(updated);
          setNewEntry({ ...emptyMcpEntry });
          setAdding(false);
          setAddTestResult(null);
        } else {
          setAddTestResult({ ok: false, msg: retryData.message || "Connection failed after OAuth" });
        }
      } else {
        setAddTestResult({ ok: false, msg: data.message || "Connection failed" });
      }
    } catch (err) {
      setAddTestResult({ ok: false, msg: err instanceof Error ? err.message : "Network error" });
    } finally {
      setAddTesting(false);
    }
  }, [newEntry, servers, saveServers, startAddOAuthFlow, t]);

  const startOAuthFlow = useCallback(async (
    idx: number,
    oauthConfig: OAuthConfig,
    flowType: "testExisting" | "reauthorize" = "testExisting",
  ): Promise<OAuthTokens | null> => {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);
    const redirectUri = `${window.location.origin}/auth/mcp-oauth-callback`;

    const params = new URLSearchParams({
      response_type: "code",
      client_id: oauthConfig.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (oauthConfig.scopes.length > 0) {
      params.set("scope", oauthConfig.scopes.join(" "));
    }

    const authUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;

    setTestResults((prev) => ({
      ...prev,
      [idx]: { ok: false, msg: t("settings.mcp.oauthAuthenticating") },
    }));

    const popup = window.open(authUrl, "mcp-oauth", "width=600,height=700,popup=yes");

    // Redirect fallback when popup is blocked (common on mobile)
    if (!popup) {
      const pending: PendingMcpOAuth = {
        codeVerifier, state, redirectUri, oauthConfig,
        flowType,
        serverIndex: idx,
        serverUrl: servers[idx]?.url,
        createdAt: Date.now(),
      };
      sessionStorage.setItem(MCP_OAUTH_PENDING_KEY, JSON.stringify(pending));
      window.location.href = authUrl;
      return new Promise(() => {}); // page will navigate away
    }

    return new Promise((resolve) => {
      let resolved = false;

      const onMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== "mcp-oauth-callback") return;
        if (resolved) return;
        resolved = true;
        cleanup();

        if (event.data.error) {
          setTestResults((prev) => ({
            ...prev,
            [idx]: {
              ok: false,
              msg: t("settings.mcp.oauthFailed").replace("{{error}}", event.data.errorDescription || event.data.error),
            },
          }));
          resolve(null);
          return;
        }

        if (event.data.state !== state) {
          setTestResults((prev) => ({
            ...prev,
            [idx]: { ok: false, msg: t("settings.mcp.oauthFailed").replace("{{error}}", "State mismatch") },
          }));
          resolve(null);
          return;
        }

        try {
          const tokenRes = await fetch("/api/settings/mcp-oauth-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tokenUrl: oauthConfig.tokenUrl,
              clientId: oauthConfig.clientId,
              clientSecret: oauthConfig.clientSecret,
              code: event.data.code,
              codeVerifier,
              redirectUri,
            }),
          });
          const tokenData = await tokenRes.json();

          if (!tokenRes.ok || !tokenData.tokens) {
            setTestResults((prev) => ({
              ...prev,
              [idx]: {
                ok: false,
                msg: t("settings.mcp.oauthFailed").replace("{{error}}", tokenData.error || "Token exchange failed"),
              },
            }));
            resolve(null);
            return;
          }

          resolve(tokenData.tokens as OAuthTokens);
        } catch (err) {
          setTestResults((prev) => ({
            ...prev,
            [idx]: {
              ok: false,
              msg: t("settings.mcp.oauthFailed").replace("{{error}}", err instanceof Error ? err.message : "Token exchange error"),
            },
          }));
          resolve(null);
        }
      };

      const onStorage = (event: StorageEvent) => {
        if (event.key !== "mcp-oauth-callback" || !event.newValue) return;
        try {
          const msg = JSON.parse(event.newValue);
          if (msg.type === "mcp-oauth-callback") {
            onMessage({ data: msg, origin: window.location.origin } as MessageEvent);
          }
        } catch { /* ignore parse errors */ }
      };

      window.addEventListener("message", onMessage);
      window.addEventListener("storage", onStorage);

      const checkClosedInterval = setInterval(() => {
        if (popup && popup.closed && !resolved) {
          resolved = true;
          cleanup();
          resolve(null);
        }
      }, 500);

      function cleanup() {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("storage", onStorage);
        clearInterval(checkClosedInterval);
      }
    });
  }, [t, servers]);

  const testConnection = useCallback(async (idx: number) => {
    const server = servers[idx];
    if (!server) return;
    setTestResults((prev) => ({ ...prev, [idx]: { ok: false, msg: "Testing..." } }));
    try {
      const res = await fetch("/api/settings/mcp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: server.url,
          headers: server.headers,
          oauth: server.oauth,
          oauthTokens: server.oauthTokens,
          origin: window.location.origin,
        }),
      });
      const data = await res.json();

      // Handle refreshed tokens from server
      if (data.tokens) {
        const updated = servers.map((s, i) => i === idx ? { ...s, oauthTokens: data.tokens } : s);
        setServers(updated);
        saveServers(updated);
      }

      // Handle OAuth requirement
      if (data.needsOAuth && data.oauthDiscovery) {
        const oauthConfig: OAuthConfig = data.oauthDiscovery.config;

        if (!oauthConfig.clientId) {
          setTestResults((prev) => ({
            ...prev,
            [idx]: { ok: false, msg: t("settings.mcp.oauthFailed").replace("{{error}}", "No client ID (registration failed)") },
          }));
          return;
        }

        // Start OAuth popup flow
        const tokens = await startOAuthFlow(idx, oauthConfig);
        if (!tokens) return;

        // Store oauth config and tokens on the server entry
        const oauthUpdated = servers.map((s, i) =>
          i === idx ? { ...s, oauth: oauthConfig, oauthTokens: tokens } : s
        );
        setServers(oauthUpdated);
        saveServers(oauthUpdated);

        setTestResults((prev) => ({
          ...prev,
          [idx]: { ok: false, msg: t("settings.mcp.oauthSuccess") + " Retesting..." },
        }));

        // Retry test with the new tokens
        const retryRes = await fetch("/api/settings/mcp-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: server.url,
            headers: server.headers,
            oauth: oauthConfig,
            oauthTokens: tokens,
            origin: window.location.origin,
          }),
        });
        const retryData = await retryRes.json();

        setTestResults((prev) => ({
          ...prev,
          [idx]: { ok: retryRes.ok, msg: retryData.message || (retryRes.ok ? "Connected" : "Failed") },
        }));

        if (retryRes.ok && retryData.tools) {
          const retryUpdated = oauthUpdated.map((s, i) => i === idx ? { ...s, tools: retryData.tools as McpToolInfo[] } : s);
          setServers(retryUpdated);
          saveServers(retryUpdated);
        }
        return;
      }

      setTestResults((prev) => ({
        ...prev,
        [idx]: { ok: res.ok, msg: data.message || (res.ok ? "Connected" : "Failed") },
      }));
      if (res.ok && data.tools) {
        const updated = servers.map((s, i) => i === idx ? { ...s, tools: data.tools as McpToolInfo[] } : s);
        setServers(updated);
        saveServers(updated);
      } else if (!res.ok) {
        setServers((prev) => prev.map((s, i) => i === idx ? { ...s, tools: undefined } : s));
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [idx]: { ok: false, msg: err instanceof Error ? err.message : "Network error" },
      }));
      setServers((prev) => prev.map((s, i) => i === idx ? { ...s, tools: undefined } : s));
    }
  }, [servers, startOAuthFlow, saveServers, t]);

  const reauthorize = useCallback(async (idx: number) => {
    const server = servers[idx];
    if (!server?.oauth) return;

    const tokens = await startOAuthFlow(idx, server.oauth, "reauthorize");
    if (!tokens) return;

    const updated = servers.map((s, i) =>
      i === idx ? { ...s, oauthTokens: tokens } : s
    );
    setServers(updated);
    saveServers(updated);
    setTestResults((prev) => ({
      ...prev,
      [idx]: { ok: true, msg: t("settings.mcp.oauthSuccess") },
    }));
  }, [servers, startOAuthFlow, saveServers, t]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      {/* Server list */}
      {servers.length === 0 && !adding && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {t("settings.mcp.noServers")}
        </p>
      )}

      <div className="space-y-3 mb-6">
        {servers.map((server, idx) => (
          <div
            key={idx}
            className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800/50"
          >
            <button
              type="button"
              onClick={() => setDetailServer(server)}
              className="flex-1 min-w-0 text-left cursor-pointer hover:opacity-70 transition-opacity"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {server.name}
                </p>
                {server.oauthTokens && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
                    <ShieldCheck size={10} />
                    {t("settings.mcp.oauthAuthenticated")}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{server.url}</p>
              {server.tools && server.tools.length > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                  {t("settings.mcp.tools").replace("{{tools}}", server.tools.map(t => t.name).join(", "))}
                </p>
              )}
              {testResults[idx] && (
                <p
                  className={`text-xs mt-1 ${
                    testResults[idx].ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {testResults[idx].msg}
                </p>
              )}
            </button>
            <div className="flex items-center gap-1">
              {server.oauthTokens && (
                <button
                  type="button"
                  onClick={() => reauthorize(idx)}
                  className="p-1.5 text-gray-500 hover:text-orange-600 dark:hover:text-orange-400"
                  title={t("settings.mcp.oauthReauthorize")}
                >
                  <KeyRound size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => testConnection(idx)}
                className="p-1.5 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
                title="Test connection"
              >
                <TestTube size={16} />
              </button>
              <button
                type="button"
                onClick={() => removeServer(idx)}
                className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400"
                title="Remove"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add server inline form */}
      {adding ? (
        <div className="mb-6 p-4 border border-blue-200 dark:border-blue-800 rounded-md bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
          <div>
            <Label htmlFor="mcp-name">{t("settings.mcp.name")}</Label>
            <input
              id="mcp-name"
              type="text"
              value={newEntry.name}
              onChange={(e) => setNewEntry((p) => ({ ...p, name: e.target.value }))}
              placeholder="my-server"
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor="mcp-url">{t("settings.mcp.url")}</Label>
            <input
              id="mcp-url"
              type="text"
              value={newEntry.url}
              onChange={(e) => setNewEntry((p) => ({ ...p, url: e.target.value }))}
              placeholder="http://localhost:3001/sse"
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor="mcp-headers">{t("settings.mcp.headers")}</Label>
            <textarea
              id="mcp-headers"
              rows={2}
              value={newEntry.headers}
              onChange={(e) => setNewEntry((p) => ({ ...p, headers: e.target.value }))}
              className={inputClass + " font-mono resize-y"}
            />
          </div>
          {addTestResult && (
            <p
              className={`text-xs ${
                addTestResult.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {addTestResult.msg}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={testAndAddServer}
              disabled={addTesting || !newEntry.name.trim() || !newEntry.url.trim()}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {addTesting ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
              {t("settings.mcp.testAndAdd")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewEntry({ ...emptyMcpEntry });
                setAddTestResult(null);
              }}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 text-sm"
        >
          <Plus size={16} />
          {t("settings.mcp.addServer")}
        </button>
      )}

      {detailServer && (
        <McpServerDetailModal server={detailServer} onClose={() => setDetailServer(null)} />
      )}

    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// MCP Server Detail Modal
// ---------------------------------------------------------------------------

export function McpServerDetailModal({
  server,
  onClose,
}: {
  server: McpServerConfig;
  onClose: () => void;
}) {
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {server.name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{server.url}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 flex-shrink-0 ml-2"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {server.tools && server.tools.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                Tools ({server.tools.length})
              </p>
              <div className="space-y-1">
                {server.tools.map((tool) => {
                  const isExpanded = expandedTool === tool.name;
                  return (
                    <div key={tool.name} className="rounded border border-gray-200 dark:border-gray-700">
                      <button
                        type="button"
                        onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                        className="flex items-start gap-2 w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
                      >
                        {isExpanded ? (
                          <ChevronDown size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
                        ) : (
                          <ChevronRight size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {tool.name}
                          </p>
                          {tool.description && !isExpanded && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                              {tool.description}
                            </p>
                          )}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 space-y-2">
                          {tool.description && (
                            <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                              {tool.description}
                            </p>
                          )}
                          {tool.inputSchema && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                                Input Schema
                              </p>
                              <pre className="text-xs bg-gray-100 dark:bg-gray-800 rounded p-2 overflow-auto max-h-[300px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                {JSON.stringify(tool.inputSchema, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
              No tools available
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
