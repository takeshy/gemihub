/**
 * Personal (non-org) Vertex AI on the Drive mount.
 *
 * A user who selected Vertex AI in Settings > General runs EVERY AI feature —
 * chat, workflow command nodes, AI workflow/base generation, plugin chat,
 * scheduled runs — on Vertex, and the stored Gemini API key is left unused.
 * Two billing sources exist:
 *
 *   "prepaid" — our own GCP project, drawn against the user's personal balance
 *               (`users/{uid}/aiBalance`); every call carries a billing scope.
 *   "own"     — the user's own GCP project through the OAuth connection they
 *               made with their uploaded client JSON; no GemiHub billing.
 *
 * Both the interactive routes and the scheduler resolve the run through
 * `personalVertexRunForUser` so the precedence rule lives in one place.
 */
import type { TenantInfo } from "~/types/enterprise";
import { AVAILABLE_MODELS, normalizeDeprecatedModelName, type UserSettings } from "~/types/settings";
import { isVertexModelPriced } from "../ai-budget.server";
import { emailToUid } from "../organizations.server";

export interface PersonalVertexRun {
  tenant: TenantInfo;
  /** Absent for the customer-owned project: nothing to draw down. */
  billing?: { uid: string; scope: "personal" };
}

/**
 * The model has to be one settings can select AND one we can price: an
 * unpriced model would be drawn down at the Pro-tier fallback while Google
 * charges the real rate. The own-project source is held to the same list so
 * a model is either available on personal Vertex or not, regardless of who
 * pays.
 */
const PERSONAL_ALLOWED_MODELS: ReadonlySet<string> = new Set(
  AVAILABLE_MODELS.map((model) => model.name),
);

/**
 * A single request must not be able to run away with the balance, so the
 * personal path caps tool rounds well below the 50 the org path allows.
 */
export const PERSONAL_MAX_FUNCTION_CALLS = 15;

export function isPersonalVertexModelAllowed(model: string): boolean {
  const normalized = normalizeDeprecatedModelName(model) ?? model;
  return PERSONAL_ALLOWED_MODELS.has(normalized) && isVertexModelPriced(normalized);
}

export function assertPersonalVertexModel(model: string): void {
  if (!isPersonalVertexModelAllowed(model)) {
    throw new Error(`model "${model}" is not available on personal Vertex AI`);
  }
}

type PersonalVertexSettings = Pick<
  UserSettings,
  "usePersonalVertex" | "personalVertexSource" | "personalVertexProjectId" | "personalVertexLocation"
>;

/** Build a TenantInfo for the user's chosen source. */
export function personalVertexTenant(uid: string, settings: PersonalVertexSettings): TenantInfo {
  const own = settings.personalVertexSource === "own";
  return {
    gcsBucket: "",
    region: process.env.DEFAULT_TENANT_REGION || "global",
    vertexProjectId: own ? settings.personalVertexProjectId?.trim() : process.env.GCP_PROJECT_ID || "",
    vertexLocation: own
      ? settings.personalVertexLocation?.trim() || "global"
      : process.env.VERTEX_LOCATION || process.env.DEFAULT_TENANT_REGION || "global",
    ...(own ? { vertexOAuthUserId: uid, vertexBillingMode: "customer" as const } : {}),
  };
}

/**
 * Resolve the run for a uid that HAS opted into personal Vertex. Throws when
 * the own-project source is missing its project ID: falling through to the
 * service project would run the user's OAuth token against a project it has
 * no access to, or worse, bill our project with no balance to charge.
 */
export function resolvePersonalVertexRun(uid: string, settings: PersonalVertexSettings): PersonalVertexRun {
  const own = settings.personalVertexSource === "own";
  if (own && !settings.personalVertexProjectId?.trim()) {
    throw new Error("Set a Google Cloud project ID before using your own Vertex AI.");
  }
  return {
    tenant: personalVertexTenant(uid, settings),
    ...(own ? {} : { billing: { uid, scope: "personal" as const } }),
  };
}

/**
 * The run for a user's settings, or null when the user has not selected
 * Vertex AI (or the session has no email to key a balance on). Callers use
 * `null` to fall back to the Gemini API key path.
 */
export function personalVertexRunForUser(
  email: string | undefined,
  settings: PersonalVertexSettings | undefined | null,
): PersonalVertexRun | null {
  if (settings?.usePersonalVertex !== true) return null;
  const uid = emailToUid(email ?? "");
  if (!uid) return null;
  return resolvePersonalVertexRun(uid, settings);
}
