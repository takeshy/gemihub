import type { Route } from "./+types/api.members.ai-budget";
import { auditFromRoute } from "~/services/audit-log.server";
import { ProjectAccessError, requireOrgAccess } from "~/services/project-acl.server";
import { getOrgMember, setOrgMemberMonthlyBudgetOverride } from "~/services/organizations.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.orgId !== "string" || typeof body.uid !== "string") {
    return Response.json({ error: "orgId and uid are required" }, { status: 400 });
  }
  try {
    const access = await requireOrgAccess(request, body.orgId);
    if (access.role !== "owner" && access.role !== "admin") {
      return Response.json({ error: "only organization administrators can change user AI budgets" }, { status: 403 });
    }
    const target = await getOrgMember(body.orgId, body.uid);
    if (!target) return Response.json({ error: "member not found" }, { status: 404 });
    let value: number | null = null;
    if (body.monthlyBudgetUsdOverride !== null && body.monthlyBudgetUsdOverride !== "") {
      const parsed = Number(body.monthlyBudgetUsdOverride);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000_000) {
        return Response.json({ error: "user budget must be empty or greater than 0" }, { status: 400 });
      }
      value = Math.round(parsed * 100) / 100;
    }
    await setOrgMemberMonthlyBudgetOverride(body.orgId, body.uid, value);
    auditFromRoute({
      orgId: body.orgId,
      uid: access.uid,
      email: access.email,
      action: "settings.update",
      resourceType: "org_member",
      resourceId: body.uid,
      metadata: { scope: "member_ai_budget", targetEmail: target.email, monthlyBudgetUsdOverride: value },
      request,
      statusCode: 200,
    });
    return Response.json({ ok: true, monthlyBudgetUsdOverride: value });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "failed to save user AI budget" }, { status: 400 });
  }
}
