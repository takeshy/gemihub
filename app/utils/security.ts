/**
 * Validate that a redirect URL is a safe relative path.
 * Prevents open redirect attacks.
 */
export function validateRedirectUrl(
  url: string | null,
  fallback = "/pages/home"
): string {
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.includes("\\")) {
    return fallback;
  }
  // Normalize and reject path traversal
  try {
    const parsed = new URL(url, "http://localhost");
    const reconstructed = parsed.pathname + parsed.search + parsed.hash;
    if (reconstructed !== url) return fallback;
  } catch {
    return fallback;
  }
  return url;
}

/**
 * Validate that an email header value contains no newline characters.
 * Prevents email header injection attacks.
 */
export function validateEmailHeader(
  value: string,
  fieldName: string
): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${fieldName} contains invalid characters`);
  }
  return value;
}

/**
 * Validate the Origin (or Referer) header matches the request host.
 * Provides CSRF protection for form submissions.
 */
export function validateOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");

  // Require at least one of Origin or Referer for state-mutating requests
  if (!origin && !referer) {
    throw new Response("Forbidden: missing origin", { status: 403 });
  }

  try {
    const requestHost = new URL(request.url).host;

    if (origin) {
      const originHost = new URL(origin).host;
      if (requestHost !== originHost) {
        throw new Response("Forbidden: cross-origin request", { status: 403 });
      }
    } else if (referer) {
      const refererHost = new URL(referer).host;
      if (requestHost !== refererHost) {
        throw new Response("Forbidden: cross-origin request", { status: 403 });
      }
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    throw new Response("Forbidden: invalid origin", { status: 403 });
  }
}
