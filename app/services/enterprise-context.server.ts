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

  // Resolve role: direct project membership first, then organization
  // owner/admin auto-promotion.
  const directMember = await getProjectMember(currentOrgId, currentProjectId, uid);
  let role = directMember?.role ?? null;
  if (!role) {
    const orgMember = await getOrgMember(currentOrgId, uid);
    if (orgMember) role = orgRoleAutoProjectRole(orgMember.role, project.id);
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

  const view: EnterpriseSelectionView = {
    orgId: currentOrgId,
    projectId: currentProjectId,
    projectName: project.name,
    role,
    allowedModels: project.allowedModels,
    gcsPrefix: project.gcsPrefix,
    region: process.env.DEFAULT_TENANT_REGION || org.tenantProject.region,
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
