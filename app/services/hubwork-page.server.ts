import mime from "mime-types";
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
 * Serve the root page of a Hubwork site.
 * Returns a Response if the request matches a hubwork account, or null otherwise.
 */
export async function serveHubworkRootPage(
  request: Request
): Promise<Response | null> {
  let account;
  try {
    account = await resolveHubworkAccount(request);
  } catch {
    return null;
  }

  if (account.plan !== "pro" && account.plan !== "granted") {
    return null;
  }

  let tokens;
  try {
    tokens = await getTokensForAccount(account);
  } catch {
    return new Response("Account not configured. Owner must log in to GemiHub first.", { status: 503 });
  }

  const syncMeta = await readRemoteSyncMeta(tokens.accessToken, tokens.rootFolderId);
  if (!syncMeta) {
    return new Response("Not Found", { status: 404 });
  }

  const pageIndex = buildPageIndex(syncMeta);
  const result = await resolvePageFile(tokens.accessToken, pageIndex, "index");
  if (!result) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(new Uint8Array(result.content), {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=300, s-maxage=180",
      ...SECURITY_HEADERS,
    },
  });
}

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
  const r1 = await tryRead(accessToken, pageIndex, `${path}.html`);
  if (r1) return r1;

  const r2 = await tryRead(accessToken, pageIndex, `${path}/index.html`);
  if (r2) return r2;

  const r3 = await tryRead(accessToken, pageIndex, path);
  if (r3) return r3;

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
