/**
 * Resolve a client-supplied `mount` parameter into a server-trusted
 * MountContext.
 *
 *   mount = "drive"          → the session user's own Google Drive
 *                              (gemihub root folder; requires a Google
 *                              session with Drive tokens)
 *   mount = "project:{orgId}/{id}" → an org project on GCS; access is gated by
 *                              requireProjectAccess with the given role
 *
 * Roles apply only to project mounts (read → "viewer", write → "editor");
 * the Drive mount is the user's own storage and is always read-write.
 */

import { getValidTokens } from "../google-auth.server";
import { requireProjectAccess, ProjectAccessError } from "../project-acl.server";
import { getTokens } from "../session.server";
import type { ProjectRole } from "~/types/enterprise";
import type { MountContext } from "./types";

export class MountResolutionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MountResolutionError";
  }
}

export function mountKeyForProject(orgId: string, projectId: string): string {
  return `gcs:${orgId}/${projectId}`;
}

export function mountKeyForDrive(rootFolderId: string): string {
  return `drive:${rootFolderId}`;
}

export function parseProjectMount(mount: string): { orgId?: string; projectId: string } | null {
  if (!mount.startsWith("project:")) return null;
  const value = mount.slice("project:".length);
  const separator = value.indexOf("/");
  if (separator < 0) return value ? { projectId: value } : null;
  const orgId = value.slice(0, separator);
  const projectId = value.slice(separator + 1);
  return orgId && projectId ? { orgId, projectId } : null;
}

export async function resolveMount(
  request: Request,
  mount: string,
  requiredRole: ProjectRole = "viewer",
): Promise<MountContext> {
  if (mount === "drive") {
    const tokens = await getTokens(request);
    if (!tokens?.accessToken || !tokens.rootFolderId) {
      throw new MountResolutionError(
        "a Google session with Drive access is required for the drive mount",
        401,
      );
    }
    const { tokens: valid } = await getValidTokens(request, tokens);
    return {
      kind: "drive",
      mountKey: mountKeyForDrive(valid.rootFolderId),
      canWrite: true,
      drive: {
        accessToken: valid.accessToken,
        rootFolderId: valid.rootFolderId,
      },
    };
  }

  if (mount.startsWith("project:")) {
    const projectMount = parseProjectMount(mount);
    if (!projectMount) {
      throw new MountResolutionError("missing project id in mount parameter", 400);
    }
    // Throws ProjectAccessError (401/403/404) on failure.
    const ctx = await requireProjectAccess(request, projectMount.projectId, requiredRole, {
      orgId: projectMount.orgId,
    });
    return {
      kind: "gcs-project",
      mountKey: mountKeyForProject(ctx.orgId, ctx.projectId),
      canWrite: requiredRole !== "viewer" || ctx.role !== "viewer",
      gcs: ctx,
    };
  }

  throw new MountResolutionError(
    `invalid mount parameter: ${mount} (expected "drive" or "project:{orgId}/{id}")`,
    400,
  );
}

/**
 * Resolve the session's currently-selected org project into a MountContext,
 * or null when no project is selected, Firestore is unavailable, or the
 * selection points at a project that no longer exists (callers then fall back
 * to Drive, which matches what the IDE shell shows for a stale selection).
 *
 * Anything else — a 403 denial, an infrastructure failure — is rethrown. A
 * blanket fallback would serve the caller's PERSONAL Drive using project
 * paths as Drive file ids, silently writing project content into their own
 * Drive instead of returning 403/503.
 *
 * An explicit `mount` query/body parameter overrides the session:
 * "drive" forces the Drive path even with a selection; "project:{id}" is
 * resolved strictly (errors propagate).
 */
export async function resolveProjectMountFromSession(
  request: Request,
  requiredRole: ProjectRole,
  explicitMount?: string | null,
): Promise<MountContext | null> {
  if (explicitMount === "drive") return null;
  if (explicitMount && explicitMount.startsWith("project:")) {
    return resolveMount(request, explicitMount, requiredRole);
  }
  const { isFirestoreAvailable } = await import("../firestore.server");
  if (!isFirestoreAvailable()) return null;
  const tokens = await getTokens(request);
  if (!tokens?.currentOrgId || !tokens.currentProjectId) return null;
  try {
    return await resolveMount(request, `project:${tokens.currentProjectId}`, requiredRole);
  } catch (err) {
    // Stale selection (project deleted or moved) → Drive. Everything else
    // must surface to the caller.
    if (err instanceof ProjectAccessError && err.status === 404) return null;
    throw err;
  }
}

export { ProjectAccessError };
