/**
 * Published-page resolution over the storage provider.
 *
 * Shared by hubwork.site.$ (path serving) and hubwork-page.server (root
 * page). The mount is GCS for a Business organization or Drive for a Pro
 * account (see account-mount.server.ts) — resolution below is mount-agnostic
 * and works against either via the storage provider.
 *
 * Resolution order (unchanged from the Drive-era implementation):
 *   1. Exact file: /users/abc123 → web/users/abc123.html
 *   2. Directory index: /users/ → web/users/index.html
 *   3. Exact non-HTML: /styles.css → web/styles.css
 *   4. [param] fallback: /users/abc123 → web/users/[id].html
 */

import mime from "mime-types";
import { listObjectsForSync, readObject } from "./storage/provider.server";
import type { MountContext } from "./storage/types";

const PAGES_PREFIX = "web/";

export interface ResolvedPage {
  content: Uint8Array;
  contentType: string;
}

/** Relative page paths (without the `web/` prefix) available on the mount. */
async function listPagePaths(ctx: MountContext): Promise<Set<string>> {
  const rows = await listObjectsForSync(ctx, "web");
  const paths = new Set<string>();
  for (const row of rows) {
    if (!row.relativePath.startsWith(PAGES_PREFIX)) continue;
    const relative = row.relativePath.slice(PAGES_PREFIX.length);
    if (relative) paths.add(relative);
  }
  return paths;
}

async function readPage(ctx: MountContext, relativePath: string): Promise<ResolvedPage | null> {
  try {
    const { meta, bytes } = await readObject(ctx, `${PAGES_PREFIX}${relativePath}`);
    const contentType =
      mime.lookup(relativePath) || meta.contentType || "application/octet-stream";
    return { content: bytes, contentType };
  } catch {
    return null;
  }
}

export async function resolveHubworkPage(
  ctx: MountContext,
  path: string,
): Promise<ResolvedPage | null> {
  const paths = await listPagePaths(ctx);
  if (paths.size === 0) return null;

  for (const candidate of [`${path}.html`, `${path}/index.html`, path]) {
    if (paths.has(candidate)) {
      const page = await readPage(ctx, candidate);
      if (page) return page;
    }
  }

  // [param] pattern fallback in the immediate directory
  const lastSlash = path.lastIndexOf("/");
  const parentDir = lastSlash >= 0 ? path.substring(0, lastSlash) : "";
  const prefix = parentDir ? `${parentDir}/` : "";
  for (const relativePath of paths) {
    if (!relativePath.startsWith(prefix)) continue;
    const basename = relativePath.substring(prefix.length);
    if (/^\[[^\]]+\]\.html$/.test(basename) && !basename.includes("/")) {
      const page = await readPage(ctx, relativePath);
      if (page) return page;
    }
  }

  return null;
}
