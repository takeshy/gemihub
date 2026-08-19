/**
 * Resolve a Hubwork account to a storage MountContext for published-page
 * serving. Business accounts linked to an organization project serve from
 * GCS; everyone else serves from the account owner's Drive (via the stored
 * refresh token) — which is what lets existing Drive-backed accounts and new
 * Business org projects share one serving path.
 *
 * The context this builds is a SERVICE identity: it is only ever used for
 * reads of the account's own storage, never for user-facing ACL decisions.
 */

import type { HubworkAccount } from "~/types/hubwork";
import type { ProjectAccessContext } from "~/types/enterprise";
import { getTokensForAccount } from "../hubwork-accounts.server";
import { getOrganization } from "../organizations.server";
import { getProject } from "../projects.server";
import { mountKeyForDrive, mountKeyForProject } from "./resolve-mount.server";
import type { MountContext } from "./types";

export async function mountContextForHubworkAccount(
  account: HubworkAccount,
): Promise<MountContext | null> {
  if (account.orgId && account.projectId) {
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

  const tokens = await getTokensForAccount(account);
  return {
    kind: "drive",
    mountKey: mountKeyForDrive(tokens.rootFolderId),
    canWrite: false,
    drive: {
      accessToken: tokens.accessToken,
      rootFolderId: tokens.rootFolderId,
    },
  };
}
