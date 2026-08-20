/**
 * Organization CRUD against the control-plane Firestore.
 *
 * An organization is the top-level tenant unit.
 */

import type { Organization, OrganizationAiSettings, OrgMember, OrgRole, TenantInfo } from "~/types/enterprise";
import { getFirestore, MEMBERS_SUBCOLLECTION, ORGANIZATIONS } from "./firestore.server";

interface OrganizationDoc {
  id: string;
  name: string;
  ownerUid: string;
  ownerEmail: string;
  idp: Organization["idp"];
  tenantProject?: TenantInfo;
  aiSettings?: Partial<OrganizationAiSettings>;
  storageAddons?: Record<string, number>;
  budgetAnchorDay?: number;
  createdAt: number;
}

interface OrgMemberDoc {
  uid: string;
  email: string;
  role: OrgRole;
  joinedAt: number;
  monthlyBudgetUsdOverride?: number | null;
}

const ORG_ID_RE = /^[a-z0-9]{6,16}$/;
const DEFAULT_AI_SETTINGS: OrganizationAiSettings = {
  vertexProjectId: "",
  vertexLocation: "global",
  monthlyBudgetUsd: null,
  defaultUserMonthlyBudgetUsd: null,
};

export function emailToUid(email: string): string {
  return email.trim().toLowerCase();
}

function orgDoc(orgId: string) {
  return getFirestore().collection(ORGANIZATIONS).doc(orgId);
}

function memberDoc(orgId: string, uid: string) {
  return orgDoc(orgId).collection(MEMBERS_SUBCOLLECTION).doc(uid);
}

function toOrganization(doc: OrganizationDoc): Organization {
  const storedTenant = doc.tenantProject ?? {
    gcsBucket: "",
    region: "global",
  };
  // Production uses one Terraform-managed bucket with an organization/project
  // prefix for tenant isolation. Treat the deployment setting as authoritative
  // so organizations created before the bucket was wired into Cloud Run do not
  // remain pointed at the old, synthesized (and never-created) gemihub-{orgId}
  // bucket name stored in Firestore.
  const configuredBucket = process.env.GCS_BUCKET_NAME?.trim();
  return {
    id: doc.id,
    name: doc.name,
    ownerUid: doc.ownerUid,
    idp: doc.idp ?? null,
    tenantProject: configuredBucket
      ? { ...storedTenant, gcsBucket: configuredBucket }
      : storedTenant,
    aiSettings: { ...DEFAULT_AI_SETTINGS, ...doc.aiSettings },
    storageAddons: doc.storageAddons ?? {},
    ...(typeof doc.budgetAnchorDay === "number" ? { budgetAnchorDay: doc.budgetAnchorDay } : {}),
    createdAt: doc.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Organization CRUD
// ---------------------------------------------------------------------------

export async function createOrganization(input: {
  orgId: string;
  name: string;
  ownerUid: string;
  ownerEmail: string;
  tenantProject?: TenantInfo;
}): Promise<Organization> {
  if (!ORG_ID_RE.test(input.orgId)) {
    throw new Error(`invalid orgId: must match ${ORG_ID_RE} (got "${input.orgId}")`);
  }
  const ref = orgDoc(input.orgId);
  const snap = await ref.get();
  if (snap.exists) {
    throw new Error(`organization ${input.orgId} already exists`);
  }
  const now = Date.now();
  const stub: OrganizationDoc = {
    id: input.orgId,
    name: input.name,
    ownerUid: input.ownerUid,
    ownerEmail: input.ownerEmail,
    idp: null,
    tenantProject: input.tenantProject,
    aiSettings: DEFAULT_AI_SETTINGS,
    createdAt: now,
  };
  await ref.set(stub);
  await memberDoc(input.orgId, input.ownerUid).set({
    uid: input.ownerUid,
    email: input.ownerEmail,
    // The creator is the Owner. Nothing else writes this role, and the
    // "only a service administrator may remove/demote an owner" guards in
    // api.members.{remove,update-role} depend on it existing.
    role: "owner" as OrgRole,
    joinedAt: now,
  } satisfies OrgMemberDoc);
  return toOrganization(stub);
}

/**
 * Record / remove a storage add-on subscription (500 GB units). Keyed by the
 * Stripe subscription id, so webhook retries are naturally idempotent.
 */
export async function setOrgStorageAddon(
  orgId: string,
  subscriptionId: string,
  units: number,
): Promise<void> {
  await orgDoc(orgId).set(
    { storageAddons: { [subscriptionId]: units } },
    { mergeFields: [`storageAddons.${subscriptionId}`] },
  );
}

export async function removeOrgStorageAddon(
  orgId: string,
  subscriptionId: string,
): Promise<void> {
  const { FieldValue } = await import("@google-cloud/firestore");
  await orgDoc(orgId).update({
    [`storageAddons.${subscriptionId}`]: FieldValue.delete(),
  });
}

/** Persist the tenant project configuration for an existing organization. */
export async function setTenantProject(
  orgId: string,
  tenant: TenantInfo,
): Promise<void> {
  await orgDoc(orgId).set({ tenantProject: tenant }, { merge: true });
}

export async function setOrganizationAiSettings(
  orgId: string,
  settings: OrganizationAiSettings,
): Promise<void> {
  await orgDoc(orgId).set({ aiSettings: settings }, { merge: true });
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const snap = await orgDoc(orgId).get();
  if (!snap.exists) return null;
  return toOrganization(snap.data() as OrganizationDoc);
}

/** All organizations, for service-super-admin control-plane views only. */
export async function listAllOrganizations(): Promise<Organization[]> {
  const snap = await getFirestore().collection(ORGANIZATIONS).get();
  return snap.docs.map((doc) => toOrganization(doc.data() as OrganizationDoc));
}

/**
 * Find every organization that has the given uid as a member. Uses a
 * collection-group query on `members`, which requires each member doc
 * to carry its own `uid` field (we always write it).
 */
export async function listOrganizationsForUser(uid: string): Promise<Organization[]> {
  const memberSnaps = await getFirestore()
    .collectionGroup(MEMBERS_SUBCOLLECTION)
    .where("uid", "==", uid)
    .get();
  if (memberSnaps.empty) return [];

  // Each member doc lives at organizations/{orgId}/members/{uid} OR at
  // organizations/{orgId}/projects/{projectId}/members/{uid}. Filter to
  // the org-level ones (path depth 4) and look up parent orgs.
  const orgIds = new Set<string>();
  for (const m of memberSnaps.docs) {
    // Path: organizations/{orgId}/members/{uid}
    const parts = m.ref.path.split("/");
    if (parts.length === 4 && parts[0] === ORGANIZATIONS && parts[2] === MEMBERS_SUBCOLLECTION) {
      orgIds.add(parts[1]);
    }
  }
  if (orgIds.size === 0) return [];

  const fetched = await Promise.all(
    Array.from(orgIds).map(async (orgId) => getOrganization(orgId)),
  );
  return fetched.filter((o): o is Organization => o !== null);
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * For tests / development only — clears the entire `organizations/{orgId}`
 * subtree.
 */
export async function _hardDeleteOrgForTests(orgId: string): Promise<void> {
  const fs = getFirestore();
  await fs.recursiveDelete(orgDoc(orgId));
}

// ---------------------------------------------------------------------------
// IdP configuration (Phase 5e-step2)
// ---------------------------------------------------------------------------

/**
 * Set or replace the OIDC IdP configuration for an organization. Pass null
 * to clear (org falls back to plain Google OAuth).
 *
 * Note: clientSecretRef should already point at a secret store (e.g. GCP
 * Secret Manager). For Phase 5e-step2 we accept the literal client secret
 * here for simplicity; a follow-up will move secrets out of Firestore.
 */
export async function setOrgIdp(
  orgId: string,
  idp: Organization["idp"],
): Promise<void> {
  // Firestore can't store undefined; persist `null` to clear the field.
  await orgDoc(orgId).set({ idp: idp ?? null }, { merge: true });
}

/**
 * Look up the org with a matching email-domain claim in its OIDC IdP config.
 * Used by the OIDC callback to figure out which org a federated user belongs
 * to without having to ask them.
 */
export async function findOrgByEmailDomain(domain: string): Promise<Organization | null> {
  const lc = domain.trim().toLowerCase();
  if (!lc) return null;
  // Firestore array-contains on a nested field works directly.
  const snap = await getFirestore()
    .collection(ORGANIZATIONS)
    .where("idp.domains", "array-contains", lc)
    .limit(2)
    .get();
  if (snap.empty) return null;
  if (snap.size > 1) {
    throw new Error(
      `email domain "${lc}" is registered to multiple orgs — refusing ambiguous match`,
    );
  }
  return toOrganization(snap.docs[0].data() as OrganizationDoc);
}

// ---------------------------------------------------------------------------
// Org membership
// ---------------------------------------------------------------------------

export async function getOrgMember(orgId: string, uid: string): Promise<OrgMember | null> {
  const snap = await memberDoc(orgId, uid).get();
  if (!snap.exists) return null;
  return snap.data() as OrgMember;
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const snap = await orgDoc(orgId).collection(MEMBERS_SUBCOLLECTION).get();
  return snap.docs.map((d) => d.data() as OrgMember);
}

export async function addOrgMember(input: {
  orgId: string;
  uid: string;
  email: string;
  role: OrgRole;
}): Promise<void> {
  const existing = await getOrgMember(input.orgId, input.uid);
  await memberDoc(input.orgId, input.uid).set({
    uid: input.uid,
    email: input.email,
    role: input.role,
    joinedAt: Date.now(),
    ...(existing?.monthlyBudgetUsdOverride !== undefined
      ? { monthlyBudgetUsdOverride: existing.monthlyBudgetUsdOverride }
      : {}),
  } satisfies OrgMemberDoc);
}

export async function setOrgMemberMonthlyBudgetOverride(
  orgId: string,
  uid: string,
  monthlyBudgetUsdOverride: number | null,
): Promise<void> {
  const member = await getOrgMember(orgId, uid);
  if (!member) throw new Error(`${uid} is not a member of this organization`);
  await memberDoc(orgId, uid).set({ monthlyBudgetUsdOverride }, { merge: true });
}

/**
 * Pin the organization's AI budget window to its billing cycle. Called when a
 * subscription starts; `day` is the renewal day of month (1–31).
 */
export async function setOrgBudgetAnchorDay(orgId: string, day: number): Promise<void> {
  if (!Number.isInteger(day) || day < 1 || day > 31) return;
  await orgDoc(orgId).set({ budgetAnchorDay: day }, { merge: true });
}

export async function removeOrgMember(orgId: string, uid: string): Promise<void> {
  await memberDoc(orgId, uid).delete();
}

// inviteOrgMember is implemented in app/services/invites.server.ts (createInvite)
// and consumed by app/routes/api.members.invite.tsx. This stub is no longer used.
