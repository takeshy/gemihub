import type { Route } from "./+types/api.workflow.http-fetch";
import { requireAuth } from "~/services/session.server";
import { createLogContext, emitLog } from "~/services/logger.server";
import { assertSafeFetchHost, DnsLookupError } from "~/services/url-validator.server";
import { checkRateLimit } from "~/services/hubwork-rate-limiter.server";
import { getSettings } from "~/services/user-settings.server";

/**
 * Server-side HTTP fetch proxy for workflow `http` nodes (Premium only).
 *
 * The browser blocks cross-origin `fetch()` unless the target sends CORS
 * headers, so a client-side workflow can't directly retrieve most public
 * URLs (e.g. note.com, GitHub content, news sites). This endpoint proxies
 * the request from the server and forwards the upstream response 1:1 —
 * status, Content-Type, and body are preserved so the client-side http
 * handler sees the same thing it would see from a direct fetch.
 *
 * Access is gated on Premium plan subscription (`settings.hubwork.plan`
 * is one of lite/pro/granted), not on `apiPlan`: the proxy is a server
 * resource paid for by the Premium subscription.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

// 2Gi memory / 80 concurrent slots on Cloud Run leaves ~25MB/slot; 20MB
// cap keeps headroom and blocks payloads that would never be useful for
// the OGP/scraping use cases this proxy serves.
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

// Shorter than the client's 60s cap so stuck upstreams release the
// Cloud Run concurrency slot before the browser gives up.
const UPSTREAM_TIMEOUT_MS = 30_000;

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const logCtx = createLogContext(request, "/api/workflow/http-fetch", tokens.rootFolderId);

  // Gate on Premium subscription (any `settings.hubwork.plan`). Users
  // without Premium can still `fetch()` same-origin and CORS-enabled
  // cross-origin endpoints directly from the browser.
  const settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
  if (!settings.hubwork?.plan) {
    emitLog(logCtx, 403, { error: "Proxy requires Premium plan" });
    return Response.json(
      { error: "HTTP proxy is available on the Premium plan only. Target CORS-enabled endpoints directly from the browser, or subscribe to Premium." },
      { status: 403 },
    );
  }

  if (!checkRateLimit(`http-fetch:${tokens.rootFolderId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    emitLog(logCtx, 429, { error: "Rate limit exceeded" });
    return Response.json(
      { error: `Rate limit exceeded (${RATE_LIMIT_MAX} req/min).` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) } },
    );
  }

  const {
    url,
    method = "GET",
    headers = {},
    body,
  } = (await request.json()) as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  if (!url) {
    emitLog(logCtx, 400, { error: "Missing url" });
    return Response.json({ error: "Missing url" }, { status: 400 });
  }

  let hostname: string;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      emitLog(logCtx, 400, { error: `Unsupported scheme: ${parsed.protocol}` });
      return Response.json(
        { error: `Unsupported URL scheme: ${parsed.protocol} (only http/https)` },
        { status: 400 },
      );
    }
    hostname = parsed.hostname;
  } catch {
    emitLog(logCtx, 400, { error: "Invalid URL" });
    return Response.json({ error: `Invalid URL: ${url}` }, { status: 400 });
  }

  try {
    await assertSafeFetchHost(hostname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof DnsLookupError) {
      emitLog(logCtx, 502, { error: msg });
      return Response.json({ error: `Upstream fetch failed: ${msg}` }, { status: 502 });
    }
    emitLog(logCtx, 400, { error: `SSRF blocked: ${msg}` });
    return Response.json({ error: `Blocked: ${msg}` }, { status: 400 });
  }

  // Default to a realistic browser User-Agent so bot-detection front-ends
  // (Cloudflare on note.com / Medium / etc.) don't 503 us for looking like
  // a server request. The caller can still override by setting their own
  // User-Agent in the node's `headers` property.
  const outHeadersInit: Record<string, string> = { ...headers };
  const hasUA = Object.keys(outHeadersInit).some((k) => k.toLowerCase() === "user-agent");
  if (!hasUA) {
    outHeadersInit["User-Agent"] =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  }
  const hasAccept = Object.keys(outHeadersInit).some((k) => k.toLowerCase() === "accept");
  if (!hasAccept) {
    outHeadersInit["Accept"] =
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
  }
  const hasAcceptLanguage = Object.keys(outHeadersInit).some(
    (k) => k.toLowerCase() === "accept-language",
  );
  if (!hasAcceptLanguage) {
    outHeadersInit["Accept-Language"] = "ja,en-US;q=0.9,en;q=0.8";
  }

  const init: RequestInit = {
    method,
    headers: outHeadersInit,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  };
  if (body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
    init.body = body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitLog(logCtx, 502, { error: msg });
    return Response.json({ error: `Upstream fetch failed: ${msg}` }, { status: 502 });
  }

  const contentLengthStr = upstream.headers.get("content-length");
  if (contentLengthStr) {
    const cl = parseInt(contentLengthStr, 10);
    if (!isNaN(cl) && cl > MAX_RESPONSE_BYTES) {
      // Release the connection without awaiting — socket close is
      // best-effort; don't block the 413 response.
      upstream.body?.cancel().catch(() => {});
      emitLog(logCtx, 413, { error: `Content-Length ${cl} > ${MAX_RESPONSE_BYTES}` });
      return Response.json(
        { error: `Response too large: ${cl} bytes (max ${MAX_RESPONSE_BYTES})` },
        { status: 413 },
      );
    }
  }

  const outHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) outHeaders.set("Content-Type", contentType);
  outHeaders.set("X-Upstream-Status", String(upstream.status));
  logCtx.details = { upstreamUrl: url, upstreamStatus: upstream.status };

  // null body on HEAD / 204 / 304 — nothing to read.
  if (!upstream.body) {
    emitLog(logCtx, upstream.status);
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  }

  // Buffer the response while enforcing the byte cap. Streaming was
  // tempting but meant an oversize body would truncate mid-stream with
  // the upstream success status already flushed — the client couldn't
  // tell a 413 from a generic fetch error. Buffering keeps the 20MB
  // memory cost (matches the cap) in exchange for correct 413 semantics.
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let transferred = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      transferred += value.byteLength;
      if (transferred > MAX_RESPONSE_BYTES) {
        reader.cancel().catch(() => {});
        emitLog(logCtx, 413, { error: `Body exceeded ${MAX_RESPONSE_BYTES}` });
        return Response.json(
          { error: `Response too large: exceeded ${MAX_RESPONSE_BYTES} bytes` },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitLog(logCtx, 502, { error: `Body read failed: ${msg}` });
    return Response.json({ error: `Upstream body read failed: ${msg}` }, { status: 502 });
  }

  emitLog(logCtx, upstream.status);
  const buffer = new Uint8Array(transferred);
  let offset = 0;
  for (const c of chunks) { buffer.set(c, offset); offset += c.byteLength; }

  return new Response(buffer, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
