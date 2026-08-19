/**
 * App Project CRUD against the control-plane Firestore.
 *
 * An "app Project" is an in-app workspace under an Organization, NOT a GCP
 * project. It maps to a bucket-internal prefix in the org's tenant bucket.
 *
 * See docs/enterprise.md §6.
 */

import type { AppProject, OrgRole, ProjectMember, ProjectRole, ProjectVisibility } from "~/types/enterprise";
import {
  getFirestore,
  MEMBERS_SUBCOLLECTION,
  ORGANIZATIONS,
  PROJECTS_SUBCOLLECTION,
} from "./firestore.server";
import {
  emailToUid,
  getOrgMember,
  listOrganizationsForUser,
} from "./organizations.server";

interface ProjectDoc {
  id: string;
  orgId: string;
  name: string;
  gcsPrefix: string;
  allowedModels: string[];
  /** Stored value may be a legacy "personal" — those docs are hidden. */
  visibility: ProjectVisibility | "personal";
  createdAt: number;
}

interface ProjectMemberDoc {
  uid: string;
  email: string;
  role: ProjectRole;
  isExternal: boolean;
  joinedAt: number;
}

const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function projectsCollection(orgId: string) {
  return getFirestore().collection(ORGANIZATIONS).doc(orgId).collection(PROJECTS_SUBCOLLECTION);
}

function projectDocRef(orgId: string, projectId: string) {
  return projectsCollection(orgId).doc(projectId);
}

function memberDocRef(orgId: string, projectId: string, uid: string) {
  return projectDocRef(orgId, projectId).collection(MEMBERS_SUBCOLLECTION).doc(uid);
}

/** Legacy personal-project docs (pre-DriveShelf) must never surface. */
function isLegacyPersonalDoc(doc: ProjectDoc): boolean {
  return doc.visibility === "personal";
}

function toAppProject(doc: ProjectDoc): AppProject {
  return {
    id: doc.id,
    orgId: doc.orgId,
    name: doc.name,
    gcsPrefix: doc.gcsPrefix,
    allowedModels: doc.allowedModels ?? [],
    visibility: "shared",
    createdAt: doc.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

export async function createProject(input: {
  orgId: string;
  projectId: string;
  name: string;
  createdByUid: string;
  createdByEmail: string;
  allowedModels?: string[];
  visibility?: ProjectVisibility;
  gcsPrefix?: string;
}): Promise<AppProject> {
  if (!PROJECT_ID_RE.test(input.projectId)) {
    throw new Error(`invalid projectId: must match ${PROJECT_ID_RE} (got "${input.projectId}")`);
  }
  const ref = projectDocRef(input.orgId, input.projectId);
  const snap = await ref.get();
  if (snap.exists) {
    throw new Error(`project ${input.orgId}/${input.projectId} already exists`);
  }

  const now = Date.now();
  const visibility = input.visibility ?? "shared";
  const doc: ProjectDoc = {
    id: input.projectId,
    orgId: input.orgId,
    name: input.name,
    gcsPrefix: input.gcsPrefix ?? input.projectId,
    allowedModels: input.allowedModels ?? [],
    visibility,
    createdAt: now,
  };
  await ref.set(doc);
  // Auto-grant the creator project.admin so they don't lock themselves out.
  await memberDocRef(input.orgId, input.projectId, input.createdByUid).set({
    uid: input.createdByUid,
    email: input.createdByEmail,
    role: "admin" as ProjectRole,
    isExternal: false,
    joinedAt: now,
  } satisfies ProjectMemberDoc);
  return toAppProject(doc);
}

export async function getProject(orgId: string, projectId: string): Promise<AppProject | null> {
  const snap = await projectDocRef(orgId, projectId).get();
  if (!snap.exists) return null;
  const doc = snap.data() as ProjectDoc;
  if (isLegacyPersonalDoc(doc)) return null;
  return toAppProject(doc);
}

export async function listProjectsInOrg(orgId: string): Promise<AppProject[]> {
  const snap = await projectsCollection(orgId).get();
  return snap.docs
    .map((d) => d.data() as ProjectDoc)
    .filter((doc) => !isLegacyPersonalDoc(doc))
    .map(toAppProject);
}

/**
 * Every project the user can access:
 *   - Direct project memberships (collection-group query with path filter)
 *   - PLUS every project under any organization the user is org.owner/admin of
 */
export async function listProjectsForUser(uid: string): Promise<AppProject[]> {
  const memberSnaps = await getFirestore()
    .collectionGroup(MEMBERS_SUBCOLLECTION)
    .where("uid", "==", uid)
    .get();

  const projectKeys = new Set<string>(); // "orgId/projectId"
  for (const m of memberSnaps.docs) {
    const parts = m.ref.path.split("/");
    // organizations/{orgId}/projects/{projectId}/members/{uid} → length 6
    if (
      parts.length === 6 &&
      parts[0] === ORGANIZATIONS &&
      parts[2] === PROJECTS_SUBCOLLECTION &&
      parts[4] === MEMBERS_SUBCOLLECTION
    ) {
      projectKeys.add(`${parts[1]}/${parts[3]}`);
    }
  }

  // Organization admins can access every shared project. Regular members are
  // automatically included in the stable Default project.
  const orgs = await listOrganizationsForUser(uid);
  for (const org of orgs) {
    const orgMember = await getOrgMember(org.id, uid);
    if (orgMember && (orgMember.role === "owner" || orgMember.role === "admin")) {
      const projects = await listProjectsInOrg(org.id);
      for (const p of projects) {
        projectKeys.add(`${p.orgId}/${p.id}`);
      }
    } else if (orgMember) {
      const defaultProject = await getProject(org.id, "default");
      if (defaultProject) projectKeys.add(`${org.id}/default`);
    }
  }

  if (projectKeys.size === 0) return [];
  const results = await Promise.all(
    Array.from(projectKeys).map(async (key) => {
      const [orgId, projectId] = key.split("/", 2);
      return getProject(orgId, projectId);
    }),
  );
  return results.filter(
    (p): p is AppProject => p !== null,
  );
}


/** Create (once) the current user's isolated project inside the organization. */

export async function updateProjectAllowedModels(
  orgId: string,
  projectId: string,
  allowedModels: string[],
): Promise<void> {
  await projectDocRef(orgId, projectId).set({ allowedModels }, { merge: true });
}

export async function renameProject(
  orgId: string,
  projectId: string,
  name: string,
): Promise<void> {
  await projectDocRef(orgId, projectId).set({ name }, { merge: true });
}

export async function deleteProject(orgId: string, projectId: string): Promise<void> {
  const members = await projectDocRef(orgId, projectId)
    .collection(MEMBERS_SUBCOLLECTION)
    .listDocuments();
  await Promise.all(members.map((doc) => doc.delete()));
  await projectDocRef(orgId, projectId).delete();
}

// ---------------------------------------------------------------------------
// Project membership
// ---------------------------------------------------------------------------

export async function getProjectMember(
  orgId: string,
  projectId: string,
  uid: string,
): Promise<ProjectMember | null> {
  const snap = await memberDocRef(orgId, projectId, uid).get();
  if (!snap.exists) return null;
  return snap.data() as ProjectMember;
}

export async function listProjectMembers(
  orgId: string,
  projectId: string,
): Promise<ProjectMember[]> {
  const snap = await projectDocRef(orgId, projectId)
    .collection(MEMBERS_SUBCOLLECTION)
    .get();
  return snap.docs.map((d) => d.data() as ProjectMember);
}

export async function addProjectMember(input: {
  orgId: string;
  projectId: string;
  uid: string;
  email: string;
  role: ProjectRole;
  isExternal: boolean;
}): Promise<void> {
  await memberDocRef(input.orgId, input.projectId, input.uid).set({
    uid: input.uid,
    email: input.email,
    role: input.role,
    isExternal: input.isExternal,
    joinedAt: Date.now(),
  } satisfies ProjectMemberDoc);
}

export async function removeProjectMember(
  orgId: string,
  projectId: string,
  uid: string,
): Promise<void> {
  await memberDocRef(orgId, projectId, uid).delete();
}

export async function updateProjectMemberRole(
  orgId: string,
  projectId: string,
  uid: string,
  role: ProjectRole,
): Promise<void> {
  await memberDocRef(orgId, projectId, uid).set({ role }, { merge: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience: convert an OrgRole to the project-level role it auto-promotes to. */
export function orgRoleAutoProjectRole(orgRole: OrgRole, projectId?: string): ProjectRole | null {
  if (orgRole === "owner" || orgRole === "admin") return "admin";
  return orgRole === "member" && projectId === "default" ? "editor" : null;
}

export { emailToUid };
