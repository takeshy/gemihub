/**
 * Shared types for the gemihub multi-tenant model.
 *
 * Terminology:
 *   - Organization (org): a tenant unit in Firestore.
 *   - Project: an in-app workspace under an organization.
 *
 * Organizations share the application control plane. Vertex AI may run in an
 * organization-selected GCP project through an Owner-connected OAuth account.
 */

export type OrgRole = "owner" | "admin" | "member";
export type ProjectRole = "admin" | "editor" | "viewer";
// Personal projects are retired — the My Drive shelf (DriveShelf) fills
// that slot. Only shared projects remain.
export type ProjectVisibility = "shared";

/**
 * Minimal tenant info. GCS bucket is shared across all orgs (isolated via
 * per-project prefixes). Vertex AI may use an organization-specific project.
 */
export interface TenantInfo {
  /** GCS bucket name */
  gcsBucket: string;
  /** Region for the bucket and Vertex AI calls. */
  region: string;
  /** Optional organization-specific Vertex AI project. Falls back to GCP_PROJECT_ID. */
  vertexProjectId?: string;
  /** Vertex AI location. Falls back to region. */
  vertexLocation?: string;
  /** Server-only organization key used to resolve stored Vertex OAuth. */
  vertexOAuthOrgId?: string;
}

export interface OrganizationAiSettings {
  vertexProjectId: string;
  vertexLocation: string;
  /** Monthly application-side estimated spend cap in USD. null means unlimited. */
  monthlyBudgetUsd: number | null;
  /** Default monthly estimated spend cap per user in USD. null means unlimited. */
  defaultUserMonthlyBudgetUsd: number | null;
}

export interface Organization {
  id: string;
  name: string;
  ownerUid: string;
  idp: OrgIdpConfig | null;
  tenantProject: TenantInfo;
  aiSettings: OrganizationAiSettings;
  /**
   * Storage add-on subscriptions: Stripe subscription id → purchased
   * 500 GB units. Effective quota = 100 GB + sum(units) × 500 GB.
   */
  storageAddons?: Record<string, number>;
  createdAt: number;
}

export type OrgIdpConfig =
  | { type: "google" }
  | {
      type: "oidc";
      issuer: string;
      clientId: string;
      // clientSecret stored encrypted at rest (resolved server-side only).
      clientSecretRef: string;
      // Email domain(s) auto-mapped to this org on first OIDC login.
      domains: string[];
    };

export interface ProjectMember {
  uid: string;
  email: string;
  role: ProjectRole;
  /** True if the user is not a member of the parent organization. */
  isExternal: boolean;
  joinedAt: number;
}

export interface OrgMember {
  uid: string;
  email: string;
  role: OrgRole;
  joinedAt: number;
  /** null/undefined inherits the organization default user budget. */
  monthlyBudgetUsdOverride?: number | null;
}

export interface AppProject {
  id: string;
  orgId: string;
  name: string;
  /** Bucket-internal prefix, conventionally just `id`. */
  gcsPrefix: string;
  /** Vertex AI models that may be selected within this project. */
  allowedModels: string[];
  visibility: ProjectVisibility;
  createdAt: number;
}

/**
 * Result of `requireProjectAccess`. Callers MUST use `tenant` and `gcsPrefix`
 * to construct any GCS / Vertex AI request — never accept these from the
 * client.
 */
export interface ProjectAccessContext {
  uid: string;
  role: ProjectRole;
  orgId: string;
  projectId: string;
  tenant: TenantInfo;
  gcsPrefix: string;
  /**
   * Vertex models the project is allowed to invoke. Empty array means
   * "all built-in defaults" (see VERTEX_MODELS). Enforced by
   * `assertModelAllowed` before each chat / generate call.
   */
  allowedModels: string[];
}

// ---------------------------------------------------------------------------
// Loader-facing types (Phase 5d-step0)
// ---------------------------------------------------------------------------

/**
 * Client-safe view of the user's tenant for the currently-selected org/project.
 * Loader returns this — the GCP project ID, bucket name, and SA email are
 * intentionally NOT included; those never need to leave the server.
 */
export interface EnterpriseSelectionView {
  orgId: string;
  projectId: string;
  projectName: string;
  role: ProjectRole;
  allowedModels: string[];
  /** Bucket-internal prefix; convenient for the client to display paths. */
  gcsPrefix: string;
  region: string;
}

/**
 * Loader return shape for enterprise context. `selection` is non-null only
 * when both currentOrgId and currentProjectId are set and the project is
 * accessible. Otherwise the IDE should direct the user to organization Settings
 * to pick (or bootstrap) one.
 */
export interface EnterpriseSessionContext {
  /** `null` when the user has no Google session at all. */
  uid: string | null;
  email: string | null;
  currentOrgId: string | null;
  currentProjectId: string | null;
  selection: EnterpriseSelectionView | null;
  /**
   * Reason `selection` is null. Useful for the IDE shell to show a helpful
   * banner ("you have no projects", "tenant still provisioning", etc.).
   */
  selectionStatus:
    | "ready" // selection is non-null
    | "no-session" // no auth
    | "no-org" // org not picked
    | "no-project" // org picked but project not picked
    | "project-missing" // session points at a project that's gone
    | "not-a-member"; // session points at a project the user can't access
}
