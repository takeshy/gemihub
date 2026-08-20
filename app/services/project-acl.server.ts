/**
 * Per-request ACL middleware for app-Project-scoped APIs.
 *
 * Every route that touches GCS or Vertex AI MUST start with
 * `requireProjectAccess(...)`. The returned context carries the tenant
 * project ID, GCS bucket, and prefix — callers must use these and never
 * trust client-supplied tenant identifiers.
 *
 * Authorization rules:
 *   1. If the user is a project.{viewer|editor|admin} member at >= minRole,
 *      grant access with that role.
 *   2. Else, for shared projects only, if the user is org.owner or org.admin
 *      of the project's org, grant access as project.admin.
 *      Personal projects remain owner-only.
 *   3. Otherwise → 403.
 *
 * See docs/enterprise.md §7.
 */

import type { ProjectAccessContext, ProjectRole } from "~/types/enterprise";
import {
  getFirestore,
  ORGANIZATIONS,
  PROJECTS_SUBCOLLECTION,
} from "./firestore.server";
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
import { normalizeDeprecatedModelName } from "~/types/settings";
import { VERTEX_MODELS } from "./ai/models";
import { isVertexModelPriced } from "./ai-budget.server";
import { isSuperAdmin } from "./super-admin.server";

const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

export class ProjectAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAccessError";
  }
}

export function hasMinRole(actual: ProjectRole, min: ProjectRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min];
}

/** Resolve the calling user's uid + email from the session. Throws 401 if no session. */
async function requireSessionIdentity(
  request: Request,
): Promise<{ uid: string; email: string; currentOrgId?: string; currentProjectId?: string }> {
  const tokens = await getTokens(request);
  if (!tokens || !tokens.email) {
    throw new ProjectAccessError(401, "not authenticated");
  }
  return {
    uid: emailToUid(tokens.email),
    email: tokens.email,
    currentOrgId: tokens.currentOrgId,
    currentProjectId: tokens.currentProjectId,
  };
}

/**
 * Find the orgId that owns the given projectId. Falls back to a collection-
 * group query if the caller hasn't told us; future request shapes that carry
 * `orgId` explicitly should pass it via the optional argument to skip the
 * scan.
 */
async function findOrgIdForProject(
  projectId: string,
  preferredOrgId?: string,
): Promise<string | null> {
  if (preferredOrgId) {
    const proj = await getProject(preferredOrgId, projectId);
    if (proj) return preferredOrgId;
    return null;
  }
  const snap = await getFirestore()
    .collectionGroup(PROJECTS_SUBCOLLECTION)
    .where("id", "==", projectId)
    .limit(2)
    .get();
  if (snap.empty) return null;
  if (snap.size > 1) {
    throw new ProjectAccessError(
      404,
      `ambiguous projectId "${projectId}" — multiple orgs have it; pass orgId explicitly`,
    );
  }
  // Path: organizations/{orgId}/projects/{projectId}
  const parts = snap.docs[0].ref.path.split("/");
  if (parts.length !== 4 || parts[0] !== ORGANIZATIONS || parts[2] !== PROJECTS_SUBCOLLECTION) {
    return null;
  }
  return parts[1];
}

export interface RequireProjectAccessOptions {
  /** If provided, skip the cross-org scan and look up under this org directly. */
  orgId?: string;
}

/**
 * Resolve the current user's session and authorize them against a project.
 * Throws `ProjectAccessError` on failure (caller should turn it into a Response).
 */
export async function requireProjectAccess(
  request: Request,
  projectId: string,
  minRole: ProjectRole,
  options: RequireProjectAccessOptions = {},
): Promise<ProjectAccessContext> {
  const identity = await requireSessionIdentity(request);

  // Org resolution priority:
  //   1. caller-supplied options.orgId (explicit beats anything)
  //   2. session.currentOrgId (UI's selected org — fast path, no scan)
  //   3. collection-group scan (slow fallback, ambiguity-detected)
  const orgId = await findOrgIdForProject(
    projectId,
    options.orgId ?? identity.currentOrgId,
  );
  if (!orgId) {
    throw new ProjectAccessError(404, `project not found: ${projectId}`);
  }

  const project = await getProject(orgId, projectId);
  if (!project) {
    throw new ProjectAccessError(404, `project not found: ${orgId}/${projectId}`);
  }

  let role: ProjectRole | null = null;
  if (isSuperAdmin(identity.email)) {
    // Service administrators may administer every shared workspace.
    role = "admin";
  } else {
    const projectMember = await getProjectMember(orgId, projectId, identity.uid);
    const orgMember = await getOrgMember(orgId, identity.uid);
    if (orgMember) {
      // 1. Direct project membership wins. 2. Org owner/admin (and members on
      //    the stable default project) auto-promote.
      role = projectMember
        ? projectMember.role
        : orgRoleAutoProjectRole(orgMember.role, project.id);
    } else if (projectMember?.isExternal) {
      // Outside collaborators are deliberately project-scoped and hold no org
      // membership. An INTERNAL project member document without a matching org
      // membership is a leftover from an org removal and grants nothing.
      role = projectMember.role;
    }
  }
  if (!role) {
    throw new ProjectAccessError(
      403,
      `${identity.email} is not a member of ${orgId}/${projectId}`,
    );
  }
  if (!hasMinRole(role, minRole)) {
    throw new ProjectAccessError(
      403,
      `${identity.email} has role "${role}" but "${minRole}" or higher is required`,
    );
  }

  const org = await getOrganization(orgId);
  if (!org || !org.tenantProject) {
    throw new ProjectAccessError(404, `organization not found: ${orgId}`);
  }

  return {
    uid: identity.uid,
    role,
    orgId,
    projectId,
    tenant: {
      ...org.tenantProject,
      ...(process.env.DEFAULT_TENANT_REGION
        ? { region: process.env.DEFAULT_TENANT_REGION }
        : {}),
      vertexProjectId: org.aiSettings.vertexProjectId,
      vertexLocation: org.aiSettings.vertexLocation,
      vertexOAuthOrgId: orgId,
    },
    gcsPrefix: project.gcsPrefix,
    allowedModels: project.allowedModels,
  };
}

/**
 * Variant for routes that only need an authenticated org context (e.g. listing
 * projects in the org switcher).
 */
export async function requireOrgAccess(
  request: Request,
  orgId: string,
): Promise<{ uid: string; email: string; orgId: string; role: "owner" | "admin" | "member" }> {
  const identity = await requireSessionIdentity(request);
  if (isSuperAdmin(identity.email)) {
    const org = await getOrganization(orgId);
    if (!org) throw new ProjectAccessError(404, `organization not found: ${orgId}`);
    return { uid: identity.uid, email: identity.email, orgId, role: "admin" };
  }
  const member = await getOrgMember(orgId, identity.uid);
  if (!member) {
    throw new ProjectAccessError(
      403,
      `${identity.email} is not a member of organization ${orgId}`,
    );
  }
  return { uid: identity.uid, email: identity.email, orgId, role: member.role };
}

// ---------------------------------------------------------------------------
// Per-project model allowlist
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_MODELS: ReadonlySet<string> = new Set(Object.values(VERTEX_MODELS));

export class ModelNotAllowedError extends Error {
  status = 403 as const;
  constructor(public readonly model: string, public readonly allowed: string[]) {
    super(
      `model "${model}" is not allowed in this project (allowed: ${allowed.length ? allowed.join(", ") : "<defaults>"})`,
    );
    this.name = "ModelNotAllowedError";
  }
}

/**
 * Extends ModelNotAllowedError on purpose: every AI route already maps that
 * one to a 403 with `model` / `allowed`, so an unpriced model reports the same
 * way instead of falling through to a generic 500.
 */
export class ModelNotPricedError extends ModelNotAllowedError {
  constructor(model: string, allowed: string[]) {
    super(model, allowed);
    this.name = "ModelNotPricedError";
    this.message = `model "${model}" has no Vertex price and cannot be billed to an organization budget. Add it to MODEL_PRICING (or VERTEX_AI_PRICING_JSON) first.`;
  }
}

/**
 * Reject the request if the requested model isn't in the project's
 * `allowedModels` list. Empty list = the built-in `VERTEX_MODELS` defaults
 * are allowed.
 *
 * A model we cannot price is refused as well. Every built-in default is
 * priced, so this only bites a project that put an unknown model in its own
 * `allowedModels` — where the alternative is spending the organization's
 * budget at the Pro-tier fallback rate while Google bills us the real one
 * (an image model's output is ~10x that fallback).
 *
 * Throws `ModelNotAllowedError` / `ModelNotPricedError` (HTTP 403).
 */
export function assertModelAllowed(ctx: ProjectAccessContext, model: string): void {
  const normalizedModel = normalizeDeprecatedModelName(model) ?? model;
  const allowed = ctx.allowedModels.length > 0
    ? new Set(ctx.allowedModels.map((allowedModel) => normalizeDeprecatedModelName(allowedModel) ?? allowedModel))
    : DEFAULT_ALLOWED_MODELS;
  if (!allowed.has(normalizedModel)) {
    throw new ModelNotAllowedError(model, ctx.allowedModels);
  }
  if (!isVertexModelPriced(normalizedModel)) {
    throw new ModelNotPricedError(model, ctx.allowedModels);
  }
}
