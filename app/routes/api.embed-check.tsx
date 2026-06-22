import type { Route } from "./+types/api.embed-check";
import { requireAuth } from "~/services/session.server";
import { assertSafeFetchHost, DnsLookupError } from "~/services/url-validator.server";
import { checkRateLimit } from "~/services/hubwork-rate-limiter.server";

/**
 * Reports whether a URL can be embedded in an iframe.
 *
 * X-Frame-Options / CSP frame-ancestors blocks can't be detected from the
 * browser (a blocked iframe and a successfully-loaded cross-origin iframe both
 * expose contentDocument === null), so the client asks the server, which can
 * read the upstream response headers directly.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Decide embeddability from the upstream headers (conservative: block when unsure). */
function isEmbeddable(headers: Headers): boolean {
  const xfo = headers.get("x-frame-options");
  if (xfo) {
    const v = xfo.toLowerCase();
    // DENY / SAMEORIGIN / ALLOW-FROM all forbid embedding from our origin.
    if (v.includes("deny") || v.includes("sameorigin") || v.includes("allow-from")) {
      return false;
    }
  }

  const csp = headers.get("content-security-policy");
  if (csp) {
    const directive = csp
      .split(";")
      .map((s) => s.trim())
      .find((d) => d.toLowerCase().startsWith("frame-ancestors"));
    if (directive) {
      const val = directive.slice("frame-ancestors".length).trim().toLowerCase();
      // Only a wildcard is guaranteed to allow our origin; anything else
      // ('none', 'self', or a specific allow-list we're unlikely to be on) blocks.
      if (!val.includes("*")) return false;
    }
  }

  return true;
}

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);

  if (!checkRateLimit(`embed-check:${tokens.rootFolderId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { url } = (await request.json()) as { url?: string };
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 });

  let hostname: string;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return Response.json({ error: "Unsupported URL scheme" }, { status: 400 });
    }
    hostname = parsed.hostname;
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    await assertSafeFetchHost(hostname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof DnsLookupError ? 502 : 400;
    return Response.json({ error: msg }, { status });
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    // We only need the headers — release the body without reading it.
    res.body?.cancel().catch(() => {});
    return Response.json({ embeddable: isEmbeddable(res.headers) });
  } catch {
    // On any upstream error, don't block the UI — let the client try the iframe.
    return Response.json({ embeddable: true });
  }
}
