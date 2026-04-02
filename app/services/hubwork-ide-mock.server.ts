import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { readRemoteSyncMeta } from "~/services/sync-meta.server";
import { readFile } from "~/services/google-drive.server";
import type { SyncMeta } from "~/services/sync-diff";

const MOCK_PREFIX = "web/__gemihub/";
const MOCK_API_PREFIX = "web/__gemihub/api/";

/**
 * Read a mock file from the IDE user's Drive.
 * Used when __gemihub endpoints are accessed from a top domain (IDE).
 * Returns file content string or null.
 */
export async function readIdeMockFile(
  request: Request,
  relativePath: string,
): Promise<string | null> {
  const ideTokens = await getTokens(request);
  if (!ideTokens) return null;
  // getValidTokens may throw Response(401) if token refresh fails — let it
  // propagate so the session-destroying Set-Cookie header reaches the client.
  const { tokens: valid } = await getValidTokens(request, ideTokens);

  const syncMeta = await readRemoteSyncMeta(valid.accessToken, valid.rootFolderId);
  if (!syncMeta) return null;

  const fullPath = MOCK_PREFIX + relativePath;
  const entry = Object.entries(syncMeta.files).find(([, m]) => m.name === fullPath);
  if (!entry) return null;

  try {
    return await readFile(valid.accessToken, entry[0]);
  } catch {
    return null;
  }
}

/**
 * Resolve a mock API response from Drive.
 * Supports exact match and [param] pattern matching.
 * Returns parsed JSON or null.
 */
export async function resolveIdeMockApi(
  request: Request,
  apiPath: string,
): Promise<unknown | null> {
  const ideTokens = await getTokens(request);
  if (!ideTokens) return null;
  // getValidTokens may throw Response(401) on refresh failure — intentionally
  // not caught so the session-destroying Set-Cookie header reaches the client.
  const { tokens: valid } = await getValidTokens(request, ideTokens);

  const syncMeta = await readRemoteSyncMeta(valid.accessToken, valid.rootFolderId);
  if (!syncMeta) return null;

  const mockIndex = buildMockApiIndex(syncMeta);
  const resolved = resolveMockApiFile(mockIndex, apiPath);
  if (!resolved) return null;

  try {
    const content = await readFile(valid.accessToken, resolved.fileId);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildMockApiIndex(syncMeta: SyncMeta): Map<string, string> {
  const index = new Map<string, string>();
  for (const [fileId, meta] of Object.entries(syncMeta.files)) {
    if (meta.name?.startsWith(MOCK_API_PREFIX) && meta.name.endsWith(".json")) {
      const relativePath = meta.name.substring(MOCK_API_PREFIX.length);
      if (relativePath) {
        index.set(relativePath, fileId);
      }
    }
  }
  return index;
}

function resolveMockApiFile(
  index: Map<string, string>,
  apiPath: string,
): { fileId: string } | null {
  // 1. Exact match
  const exactFileId = index.get(`${apiPath}.json`);
  if (exactFileId) return { fileId: exactFileId };

  // 2. [param] pattern fallback
  const lastSlash = apiPath.lastIndexOf("/");
  const parentDir = lastSlash >= 0 ? apiPath.substring(0, lastSlash) : "";
  const prefix = parentDir ? `${parentDir}/` : "";

  for (const [relativePath, fileId] of index) {
    if (!relativePath.startsWith(prefix)) continue;
    const basename = relativePath.substring(prefix.length);
    if (/^\[[^\]]+\]\.json$/.test(basename) && !basename.includes("/")) {
      return { fileId };
    }
  }

  return null;
}
