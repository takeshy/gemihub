import type { SyncMeta } from "~/services/sync-diff";

const ADMIN_API_PREFIX = "admin/api/";

/**
 * Build an index of admin API workflow files from sync meta.
 * Only includes .yaml files under admin/api/.
 *
 * admin/ is deliberately outside web/ — the Hubwork public serving layer only
 * exposes web/*, so admin/* is automatically 404 from the custom domain. These
 * workflows are reachable only through the IDE's admin preview, where the
 * Drive owner's session supplies the execution identity.
 *
 * Returns Map<relativePath, fileId> (e.g., "bookings/status.yaml" → fileId).
 */
export function buildAdminApiIndex(syncMeta: SyncMeta): Map<string, string> {
  const index = new Map<string, string>();
  for (const [fileId, meta] of Object.entries(syncMeta.files)) {
    if (meta.name?.startsWith(ADMIN_API_PREFIX) && meta.name.endsWith(".yaml")) {
      const relativePath = meta.name.substring(ADMIN_API_PREFIX.length);
      if (relativePath) {
        index.set(relativePath, fileId);
      }
    }
  }
  return index;
}

/**
 * Resolve an admin API path to a workflow file.
 *
 * Resolution order (mirrors the public hubwork-api-resolver):
 * 1. Exact match: bookings/status → bookings/status.yaml
 * 2. [param] pattern: inquiries/abc123 → inquiries/[id].yaml (params = { id: "abc123" })
 */
export function resolveAdminApiWorkflow(
  apiIndex: Map<string, string>,
  apiPath: string
): { fileId: string; params: Record<string, string> } | null {
  const exactKey = `${apiPath}.yaml`;
  const exactFileId = apiIndex.get(exactKey);
  if (exactFileId) {
    return { fileId: exactFileId, params: {} };
  }

  const lastSlash = apiPath.lastIndexOf("/");
  const parentDir = lastSlash >= 0 ? apiPath.substring(0, lastSlash) : "";
  const segment = lastSlash >= 0 ? apiPath.substring(lastSlash + 1) : apiPath;
  const prefix = parentDir ? `${parentDir}/` : "";

  for (const [relativePath, fileId] of apiIndex) {
    if (!relativePath.startsWith(prefix)) continue;
    const basename = relativePath.substring(prefix.length);
    const paramMatch = /^\[([^\]]+)\]\.yaml$/.exec(basename);
    if (paramMatch && !basename.includes("/")) {
      const paramName = paramMatch[1];
      return { fileId, params: { [paramName]: segment } };
    }
  }

  return null;
}
