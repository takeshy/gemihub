import type { Route } from "./+types/api.orgs.ai-settings";
import { auditFromRoute } from "~/services/audit-log.server";
import { ProjectAccessError, requireOrgAccess } from "~/services/project-acl.server";
import { getOrganization, setOrganizationAiSettings } from "~/services/organizations.server";
import type { OrganizationAiSettings } from "~/types/enterprise";
import {
  BUSINESS_INCLUDED_AI_BUDGET_USD,
  getOrganizationAiUsage,
  resolveOrgTopUp,
} from "~/services/ai-budget.server";
import { getOrganizationVertexOAuthStatus } from "~/services/vertex-oauth.server";
import {
  BUSINESS_INCLUDED_STORAGE_GB,
  getOrgStorageUsageBytes,
  storageAddonUnits,
  storageQuotaGbForOrg,
} from "~/services/storage-quota.server";

const RESOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function budget(value: unknown): number | null {
  if (value === null || value === "" || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000) {
    throw new Error("budget must be a number from 0 to 10000000");
  }
  return parsed === 0 ? null : Math.round(parsed * 100) / 100;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.orgId !== "string") {
    return Response.json({ error: "orgId is required" }, { status: 400 });
  }
  try {
    const access = await requireOrgAccess(request, body.orgId);
    if (access.role !== "owner" && access.role !== "admin") {
      return Response.json({ error: "only organization administrators can change AI settings" }, { status: 403 });
    }
    const vertexProjectId = typeof body.vertexProjectId === "string" ? body.vertexProjectId.trim() : "";
    const vertexLocation = typeof body.vertexLocation === "string" ? body.vertexLocation.trim() : "global";
    if (vertexProjectId && !RESOURCE_RE.test(vertexProjectId)) {
      return Response.json({ error: "invalid Google Cloud project ID" }, { status: 400 });
    }
    if (!RESOURCE_RE.test(vertexLocation)) {
      return Response.json({ error: "invalid Vertex AI location" }, { status: 400 });
    }
    const settings: OrganizationAiSettings = {
      vertexProjectId,
      vertexLocation,
      monthlyBudgetUsd: budget(body.monthlyBudgetUsd),
      defaultUserMonthlyBudgetUsd: budget(body.defaultUserMonthlyBudgetUsd),
    };
    await setOrganizationAiSettings(body.orgId, settings);
    auditFromRoute({
      orgId: body.orgId,
      uid: access.uid,
      email: access.email,
      action: "settings.update",
      resourceType: "organization",
      resourceId: body.orgId,
      metadata: { ...settings, scope: "organization_ai" },
      request,
      statusCode: 200,
    });
    return Response.json({ ok: true, settings });
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : "failed to save AI settings" }, { status: 400 });
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId") ?? "";
  try {
    const access = await requireOrgAccess(request, orgId);
    if (access.role !== "owner" && access.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
    const org = await getOrganization(orgId);
    if (!org) return Response.json({ error: "organization not found" }, { status: 404 });
    const [usage, oauthStatus, storageUsedBytes] = await Promise.all([
      getOrganizationAiUsage(orgId),
      getOrganizationVertexOAuthStatus(orgId),
      getOrgStorageUsageBytes(orgId, org.tenantProject).catch(() => null),
    ]);
    // Mirror the storage block: what the plan includes, what was purchased on
    // top, and the resulting ceiling — otherwise the section only shows spend
    // with nothing to compare it against.
    const includedBudgetUsd = BUSINESS_INCLUDED_AI_BUDGET_USD;
    const configuredBudgetUsd = org.aiSettings.monthlyBudgetUsd;
    // Top-ups stay usable through the end of the month after purchase, so the
    // usable balance includes last month's leftovers.
    const topUp = await resolveOrgTopUp(orgId, configuredBudgetUsd, usage.period);
    const topUpUsd = topUp.availableUsd;
    return Response.json({
      settings: org.aiSettings,
      usage,
      oauthStatus,
      budget: {
        // The window spend is measured over: a billing cycle once the org has
        // an anchor, a calendar month otherwise.
        periodStart: new Date(usage.period.startMs).toISOString().slice(0, 10),
        periodEnd: new Date(usage.period.endMs - 86_400_000).toISOString().slice(0, 10),
        followsBillingCycle: usage.period.anchorDay != null,
        includedUsd: includedBudgetUsd,
        configuredUsd: configuredBudgetUsd,
        topUpUsd,
        topUpPurchasedThisMonthUsd: topUp.purchasedThisMonthUsd,
        topUpCarriedOverUsd: topUp.carriedOverUsd,
        topUpExpiresOn: topUp.expiresOn,
        // null = unlimited (no configured ceiling).
        limitUsd:
          configuredBudgetUsd != null && configuredBudgetUsd > 0
            ? configuredBudgetUsd + topUpUsd
            : null,
      },
      storage: {
        usedBytes: storageUsedBytes,
        quotaGb: storageQuotaGbForOrg(org),
        includedGb: BUSINESS_INCLUDED_STORAGE_GB,
        addonUnits: storageAddonUnits(org),
      },
    });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
