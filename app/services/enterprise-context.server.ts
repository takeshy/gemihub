/**
 * Server-side helper that page loaders call to surface the user's
 * enterprise-tenant selection to the client.
 *
 * Strict separation from `requireProjectAccess`:
 *   - `requireProjectAccess` GATES an action (throws on failure)
 *   - `resolveEnterpriseContext` REPORTS state for rendering (never throws,
 *     `selectionStatus` enumerates why selection is null)
 *
 * See docs/enterprise.md §11 Phase 5d-step0.
 */

import type {
  EnterpriseSelectionView,
  EnterpriseSessionContext,
  ProjectRole,
} from "~/types/enterprise";
import {
  emailToUid,
  getOrganization,
  getOrgMember,
} from "./organizations.server";
import {
  getProject,
  getProjectMember,
  orgRoleAutoProjectRole,
} from "./projects.server";
import { getTokens } from "./session.server";
import { getAccountByOrganization } from "./hubwork-accounts.server";
import { cancellationDeleteAfterIso, organizationLifecycle } from "~/types/hubwork";

const NO_SESSION: EnterpriseSessionContext = {
  uid: null,
  email: null,
  currentOrgId: null,
  currentProjectId: null,
  selection: null,
  selectionStatus: "no-session",
};

export async function resolveEnterpriseContext(
  request: Request,
): Promise<EnterpriseSessionContext> {
  const tokens = await getTokens(request);
  if (!tokens?.email) return NO_SESSION;
  const uid = emailToUid(tokens.email);
  const email = tokens.email;
  const currentOrgId = tokens.currentOrgId ?? null;
  const currentProjectId = tokens.currentProjectId ?? null;

  if (!currentOrgId) {
    return {
      uid,
      email,
      currentOrgId,
      currentProjectId,
      selection: null,
      selectionStatus: "no-org",
    };
  }
  if (!currentProjectId) {
    return {
      uid,
      email,
      currentOrgId,
      currentProjectId,
      selection: null,
      selectionStatus: "no-project",
    };
  }

  const project = await getProject(currentOrgId, currentProjectId);
  if (!project) {
    return {
      uid,
      email,
      currentOrgId,
      currentProjectId,
      selection: null,
      selectionStatus: "project-missing",
    };
  }

  // Resolve role the same way requireProjectAccess does: organization
  // membership is the gate (direct project role first, then owner/admin
  // auto-promotion); only an explicitly external collaborator may hold a
  // project role without belonging to the org.
  const directMember = await getProjectMember(currentOrgId, currentProjectId, uid);
  const orgMember = await getOrgMember(currentOrgId, uid);
  let role: ProjectRole | null = null;
  if (orgMember) {
    role = directMember?.role ?? orgRoleAutoProjectRole(orgMember.role, project.id);
  } else if (directMember?.isExternal) {
    role = directMember.role;
  }
  if (!role) {
    return {
      uid,
      email,
      currentOrgId,
      currentProjectId,
      selection: null,
      selectionStatus: "not-a-member",
    };
  }

  const org = await getOrganization(currentOrgId);
  if (!org || !org.tenantProject) {
    return {
      uid,
      email,
      currentOrgId,
      currentProjectId,
      selection: null,
      selectionStatus: "no-org",
    };
  }

  // Cancellation state is reported, never enforced here: the IDE needs it to
  // explain why saving is disabled and how many days of export are left.
  const billingAccount = await getAccountByOrganization(currentOrgId);
  const readOnly = billingAccount
    ? organizationLifecycle(billingAccount) === "read-only"
    : false;

  const view: EnterpriseSelectionView = {
    orgId: currentOrgId,
    projectId: currentProjectId,
    projectName: project.name,
    role,
    allowedModels: project.allowedModels,
    gcsPrefix: project.gcsPrefix,
    region: process.env.DEFAULT_TENANT_REGION || org.tenantProject.region,
    ...(readOnly
      ? {
          readOnly,
          ...(billingAccount && cancellationDeleteAfterIso(billingAccount)
            ? { readOnlyDeleteAfter: cancellationDeleteAfterIso(billingAccount) }
            : {}),
        }
      : {}),
  };
  return {
    uid,
    email,
    currentOrgId,
    currentProjectId,
    selection: view,
    selectionStatus: "ready",
  };
}
