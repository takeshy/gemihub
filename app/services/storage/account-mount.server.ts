/**
 * Resolve a Hubwork account to its storage mount.
 *
 * Business accounts resolve to their organization's GCS project mount; an
 * account with an orgId/projectId that no longer resolves is incomplete and
 * must never silently publish stale content from Drive.
 *
 * Pro accounts also resolve to a Drive-backed MountContext: they have no
 * organization, so their site and schedules are served straight from the
 * account's own Drive root. This is a server-side read through the Drive API
 * (fresh access token via getTokensForAccount) — it bypasses the browser's
 * IndexedDB cache entirely, so client-side staleness is not a concern here.
 *
 * The context this builds is a SERVICE identity: it is only ever used for
 * reads of the account's own storage, never for user-facing ACL decisions.
 */

import type { HubworkAccount } from "~/types/hubwork";
import type { ProjectAccessContext } from "~/types/enterprise";
import { getOrganization } from "../organizations.server";
import { getProject } from "../projects.server";
import { mountKeyForDrive, mountKeyForProject } from "./resolve-mount.server";
import { getTokensForAccount } from "../hubwork-accounts.server";
import type { MountContext } from "./types";

export async function mountContextForHubworkAccount(
  account: HubworkAccount,
): Promise<MountContext | null> {
  // Pro stays on Drive — no organization is ever provisioned for it.
  if (account.plan === "pro") {
    const { accessToken } = await getTokensForAccount(account);
    return {
      kind: "drive",
      mountKey: mountKeyForDrive(account.rootFolderId),
      canWrite: false,
      drive: { accessToken, rootFolderId: account.rootFolderId },
    };
  }
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
