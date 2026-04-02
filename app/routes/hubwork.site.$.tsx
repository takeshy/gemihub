import mime from "mime-types";
import type { Route } from "./+types/hubwork.site.$";
import { resolveHubworkAccount } from "~/services/hubwork-account-resolver.server";
import { getTokensForAccount } from "~/services/hubwork-accounts.server";
import { readRemoteSyncMeta } from "~/services/sync-meta.server";
import { readFileBytes } from "~/services/google-drive.server";
import type { SyncMeta } from "~/services/sync-diff";

const SECURITY_HEADERS: HeadersInit = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const PAGES_PREFIX = "web/";

/**
 * Catch-all route for Hubwork sites.
 * Only activates on Hubwork domains (resolved via Host header).
 * Serves files directly from Drive (via _sync-meta.json lookup) with CDN caching.
 *
 * Resolution order:
 * 1. Exact file: /users/abc123 → web/users/abc123.html
 * 2. Index file: /users/ → web/users/index.html
 * 3. Exact non-HTML: /styles.css → web/styles.css
 * 4. [param] fallback: /users/abc123 → web/users/[id].html
 * 5. 404
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  let account;
  try {
    account = await resolveHubworkAccount(request);
  } catch {
    throw new Response("Not Found", { status: 404 });
  }

  // Page hosting requires Pro plan
  if (account.plan !== "pro" && account.plan !== "granted") {
    throw new Response("Not Found", { status: 404 });
  }

  let tokens;
  try {
    tokens = await getTokensForAccount(account);
  } catch {
    throw new Response("Account not configured. Owner must log in to GemiHub first.", { status: 503 });
  }

  const syncMeta = await readRemoteSyncMeta(tokens.accessToken, tokens.rootFolderId);
  if (!syncMeta) {
    throw new Response("Not Found", { status: 404 });
  }

  let rawPath = (params["*"] || "").replace(/^\/+|\/+$/g, "");
  // __gemihub_root is an internal rewrite from server.js for "/" on hubwork domains
  if (rawPath === "__gemihub_root") rawPath = "";
  // Reject path traversal attempts
  if (rawPath.includes("..") || rawPath.includes("\0")) {
    throw new Response("Not Found", { status: 404 });
  }
  const path = rawPath || "index";

  // Build a name→fileId index for web/ files
  const pageIndex = buildPageIndex(syncMeta);

  const result = await resolvePageFile(tokens.accessToken, pageIndex, path);
  if (!result) {
    throw new Response("Not Found", { status: 404 });
  }

  return new Response(new Uint8Array(result.content), {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=300, s-maxage=600",
      ...SECURITY_HEADERS,
    },
  });
}

/** Map relative path (e.g. "about.html") → fileId from _sync-meta.json */
function buildPageIndex(syncMeta: SyncMeta): Map<string, string> {
  const index = new Map<string, string>();
  for (const [fileId, meta] of Object.entries(syncMeta.files)) {
    if (meta.name?.startsWith(PAGES_PREFIX)) {
      const relativePath = meta.name.substring(PAGES_PREFIX.length);
      if (relativePath) {
        index.set(relativePath, fileId);
      }
    }
  }
  return index;
}

async function resolvePageFile(
  accessToken: string,
  pageIndex: Map<string, string>,
  path: string
): Promise<{ content: Uint8Array; contentType: string } | null> {
  // 1. Exact path with .html
  const r1 = await tryRead(accessToken, pageIndex, `${path}.html`);
  if (r1) return r1;

  // 2. Directory index
  const r2 = await tryRead(accessToken, pageIndex, `${path}/index.html`);
  if (r2) return r2;

  // 3. Exact path as-is (CSS, JS, images, etc.)
  const r3 = await tryRead(accessToken, pageIndex, path);
  if (r3) return r3;

  // 4. [param] pattern fallback
  const lastSlash = path.lastIndexOf("/");
  const parentDir = lastSlash >= 0 ? path.substring(0, lastSlash) : "";
  const prefix = parentDir ? `${parentDir}/` : "";
  for (const [relativePath] of pageIndex) {
    if (!relativePath.startsWith(prefix)) continue;
    const basename = relativePath.substring(prefix.length);
    // Match [xxx].html in the immediate directory (no deeper slashes)
    if (/^\[[^\]]+\]\.html$/.test(basename) && !basename.includes("/")) {
      const r4 = await tryRead(accessToken, pageIndex, relativePath);
      if (r4) return r4;
    }
  }

  return null;
}

async function tryRead(
  accessToken: string,
  pageIndex: Map<string, string>,
  relativePath: string
): Promise<{ content: Uint8Array; contentType: string } | null> {
  const fileId = pageIndex.get(relativePath);
  if (!fileId) return null;

  try {
    const content = await readFileBytes(accessToken, fileId);
    const contentType = mime.lookup(relativePath) || "application/octet-stream";
    return { content, contentType };
  } catch {
    return null;
  }
}
