import type { SyncMeta } from "~/services/sync-diff";

const API_PREFIX = "web/api/";

/**
 * Build an index of API workflow files from sync meta.
 * Only includes .yaml files under web/api/.
 * Returns Map<relativePath, fileId> (e.g., "users/list.yaml" → fileId).
 */
export function buildApiIndex(syncMeta: SyncMeta): Map<string, string> {
  const index = new Map<string, string>();
  for (const [fileId, meta] of Object.entries(syncMeta.files)) {
    if (meta.name?.startsWith(API_PREFIX) && meta.name.endsWith(".yaml")) {
      const relativePath = meta.name.substring(API_PREFIX.length);
      if (relativePath) {
        // Last-write-wins for duplicate paths
        index.set(relativePath, fileId);
      }
    }
  }
  return index;
}

/**
 * Resolve an API path to a workflow file.
 *
 * Resolution order:
 * 1. Exact match: users/list → users/list.yaml
 * 2. [param] pattern: users/abc123 → users/[id].yaml (params = { id: "abc123" })
 *
 * Only single-segment [param] is supported.
 */
export function resolveApiWorkflow(
  apiIndex: Map<string, string>,
  apiPath: string
): { fileId: string; params: Record<string, string> } | null {
  // 1. Exact match
  const exactKey = `${apiPath}.yaml`;
  const exactFileId = apiIndex.get(exactKey);
  if (exactFileId) {
    return { fileId: exactFileId, params: {} };
  }

  // 2. [param] pattern fallback (single segment only)
  const lastSlash = apiPath.lastIndexOf("/");
  const parentDir = lastSlash >= 0 ? apiPath.substring(0, lastSlash) : "";
  const segment = lastSlash >= 0 ? apiPath.substring(lastSlash + 1) : apiPath;
  const prefix = parentDir ? `${parentDir}/` : "";

  for (const [relativePath, fileId] of apiIndex) {
    if (!relativePath.startsWith(prefix)) continue;
    const basename = relativePath.substring(prefix.length);
    // Match [xxx].yaml in the immediate directory (no deeper slashes)
    const paramMatch = /^\[([^\]]+)\]\.yaml$/.exec(basename);
    if (paramMatch && !basename.includes("/")) {
      const paramName = paramMatch[1];
      return { fileId, params: { [paramName]: segment } };
    }
  }

  return null;
}
