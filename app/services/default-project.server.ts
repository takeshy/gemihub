import type { AppProject } from "~/types/enterprise";
import {
  emailToUid,
  getOrgMember,
  listOrganizationsForUser,
} from "./organizations.server";
import {
  createProject,
  getProject,
  listProjectsInOrg,
} from "./projects.server";

export interface SingleOrgProjectSelection {
  orgId: string;
  project: AppProject;
}

/**
 * Resolve the single organization/project case for a smoother login.
 *
 * Organizations are never created here: only a service administrator may
 * create one through /api/orgs/create. If an owner/admin already belongs to
 * exactly one organization with no shared projects, create its stable Default
 * project. Existing multi-org or multi-project installations are untouched.
 */
export async function resolveSingleOrgDefaultProject(
  email: string,
  preferredOrgId?: string | null,
): Promise<SingleOrgProjectSelection | null> {
  const uid = emailToUid(email);
  const organizations = await listOrganizationsForUser(uid);
  const organization = preferredOrgId
    ? organizations.find((candidate) => candidate.id === preferredOrgId)
    : organizations.length === 1
      ? organizations[0]
      : null;
  if (!organization) return null;

  const projects = await listProjectsInOrg(organization.id);
  const stableDefault = projects.find((project) => project.id === "default");
  if (stableDefault) return { orgId: organization.id, project: stableDefault };
  if (projects.length === 0) {
    const membership = await getOrgMember(organization.id, uid);
    if (membership?.role !== "owner" && membership?.role !== "admin") return null;
    try {
      const project = await createProject({
        orgId: organization.id,
        projectId: "default",
        name: "Default",
        createdByUid: uid,
        createdByEmail: email,
      });
      return { orgId: organization.id, project };
    } catch (error) {
      // Another concurrent request may have created the stable project.
      const existing = await getProject(organization.id, "default");
      if (existing) return { orgId: organization.id, project: existing };
      throw error;
    }
  }

  if (projects.length !== 1) return null;
  return { orgId: organization.id, project: projects[0] };
}
