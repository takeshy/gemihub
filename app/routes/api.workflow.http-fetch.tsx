import type { Route } from "./+types/api.workflow.http-fetch";
import { requireAuth } from "~/services/session.server";
import { createLogContext, emitLog } from "~/services/logger.server";

/**
 * Server-side HTTP fetch proxy for workflow `http` nodes.
 *
 * The browser blocks cross-origin `fetch()` unless the target sends CORS
 * headers, so a client-side workflow can't directly retrieve most public
 * URLs (e.g. note.com, GitHub content, news sites). This endpoint proxies
 * the request from the server and forwards the upstream response 1:1 —
 * status, Content-Type, and body are preserved so the client-side http
 * handler sees the same thing it would see from a direct fetch.
 *
 * Security: requires auth, only http/https schemes, passes arbitrary
 * user-controlled URLs so we rely on the outbound firewall to block
 * internal ranges.
 */
export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const logCtx = createLogContext(request, "/api/workflow/http-fetch", tokens.rootFolderId);

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

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      emitLog(logCtx, 400, { error: `Unsupported scheme: ${parsed.protocol}` });
      return Response.json(
        { error: `Unsupported URL scheme: ${parsed.protocol} (only http/https)` },
        { status: 400 },
      );
    }
  } catch {
    emitLog(logCtx, 400, { error: "Invalid URL" });
    return Response.json({ error: `Invalid URL: ${url}` }, { status: 400 });
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

  const init: RequestInit = { method, headers: outHeadersInit };
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

  // Forward the response body + status + content-type transparently so the
  // client-side handler sees exactly what a direct fetch would have seen.
  const buffer = await upstream.arrayBuffer();
  const outHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) outHeaders.set("Content-Type", contentType);
  // Expose useful upstream headers for debugging.
  outHeaders.set("X-Upstream-Status", String(upstream.status));

  logCtx.details = { upstreamUrl: url, upstreamStatus: upstream.status };
  emitLog(logCtx, upstream.status);

  return new Response(buffer, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
