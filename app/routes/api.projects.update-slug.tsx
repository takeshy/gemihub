import type { Route } from "./+types/api.projects.update-slug";
import {
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";
import { getSettingsForTenantStrict, saveSettingsForTenant } from "~/services/user-settings-tenant.server";
import { getTokens } from "~/services/session.server";
import { auditFromRoute } from "~/services/audit-log.server";
import {
  createAccount,
  encryptOAuthRefreshToken,
  getAccountByProject,
  getAccountBySlug,
  HUBWORK_DOMAIN,
  updateAccount,
} from "~/services/hubwork-accounts.server";

interface UpdateSlugBody {
  orgId?: unknown;
  projectId?: unknown;
  slug?: unknown;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as UpdateSlugBody | null;
  if (
    !body ||
    typeof body.orgId !== "string" ||
    typeof body.projectId !== "string" ||
    typeof body.slug !== "string"
  ) {
    return Response.json(
      { error: "missing or invalid orgId / projectId / slug" },
      { status: 400 },
    );
  }
  const orgId = body.orgId;
  const projectId = body.projectId;
  const slug = body.slug.trim();

  if (!slug) {
    return Response.json(
      { error: "subdomain must not be empty" },
      { status: 400 },
    );
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return Response.json(
      { error: "subdomain must be lowercase alphanumeric with optional hyphens" },
      { status: 400 },
    );
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "admin", { orgId });
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    // Strict: this is a read-modify-write; defaults from a failed read would
    // wipe the project's settings.json.
    const settings = await getSettingsForTenantStrict(ctx);
    const existingSlug = settings.hubwork?.accountSlug;
    if (existingSlug && existingSlug !== slug) {
      return Response.json(
        { error: `subdomain is already set to "${existingSlug}" and cannot be changed` },
        { status: 409 },
      );
    }
    const existingSlugAccount = await getAccountBySlug(slug);
    if (
      existingSlugAccount &&
      (existingSlugAccount.orgId !== orgId || existingSlugAccount.projectId !== projectId)
    ) {
      return Response.json(
        { error: `subdomain "${slug}" is already in use` },
        { status: 409 },
      );
    }

    const updatedSettings = {
      ...settings,
      hubwork: {
        ...settings.hubwork,
        accountSlug: slug,
      },
    };
    await saveSettingsForTenant(ctx, updatedSettings);

    const account =
      existingSlugAccount ??
      await getAccountByProject(orgId, projectId);
    if (account) {
      await updateAccount(account.id, {
        accountSlug: slug,
        defaultDomain: `${slug}.${HUBWORK_DOMAIN}`,
        orgId,
        projectId,
        spreadsheetId: settings.hubwork?.spreadsheets?.[0]?.id,
        ...(tokens.refreshToken ? { encryptedRefreshToken: encryptOAuthRefreshToken(tokens.refreshToken) } : {}),
      });
    } else {
      await createAccount({
        email: tokens.email,
        orgId,
        projectId,
        rootFolderName: projectId,
        rootFolderId: "",
        spreadsheetId: settings.hubwork?.spreadsheets?.[0]?.id,
        accountSlug: slug,
        refreshToken: tokens.refreshToken || "",
        plan: "granted",
      });
    }

    auditFromRoute({
      orgId,
      projectId,
      uid: ctx.uid,
      email: tokens.email,
      action: "project.update-slug",
      resourceType: "project",
      resourceId: projectId,
      metadata: { slug },
      request,
      statusCode: 200,
    });
    return Response.json({ success: true, slug });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditFromRoute({
      orgId,
      projectId,
      uid: ctx.uid,
      email: tokens.email,
      action: "project.update-slug",
      resourceType: "project",
      resourceId: projectId,
      metadata: { slug, error: message },
      request,
      statusCode: 400,
      errorMessage: message,
    });
    return Response.json(
      { error: message },
      { status: 400 },
    );
  }
}
