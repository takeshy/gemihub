/**
 * Resolve a Business Hubwork account to its organization project mount.
 * Hubwork hosting is GCS-only: an account without an organization project is
 * incomplete and must never silently publish stale content from Drive.
 *
 * The context this builds is a SERVICE identity: it is only ever used for
 * reads of the account's own storage, never for user-facing ACL decisions.
 */

import type { HubworkAccount } from "~/types/hubwork";
import type { ProjectAccessContext } from "~/types/enterprise";
import { getOrganization } from "../organizations.server";
import { getProject } from "../projects.server";
import { mountKeyForProject } from "./resolve-mount.server";
import type { MountContext } from "./types";

export async function mountContextForHubworkAccount(
  account: HubworkAccount,
): Promise<MountContext | null> {
  if (!account.orgId || !account.projectId) return null;
  const [org, project] = await Promise.all([
    getOrganization(account.orgId),
    getProject(account.orgId, account.projectId),
  ]);
  if (!org?.tenantProject?.gcsBucket || !project) return null;
  const ctx: ProjectAccessContext = {
    uid: `hubwork:${account.id}`,
    role: "viewer",
    orgId: account.orgId,
    projectId: account.projectId,
    tenant: org.tenantProject,
    gcsPrefix: project.gcsPrefix,
    allowedModels: project.allowedModels,
  };
  return {
    kind: "gcs-project",
    mountKey: mountKeyForProject(account.orgId, account.projectId),
    canWrite: false,
    gcs: ctx,
  };
}
