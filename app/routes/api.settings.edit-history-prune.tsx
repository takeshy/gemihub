import type { Route } from "./+types/api.settings.edit-history-prune";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { prune } from "~/services/edit-history.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  {
    const peek = (await request.clone().json().catch(() => null)) as { projectId?: unknown; orgId?: unknown } | null;
    if (peek && typeof peek.projectId === "string" && peek.projectId) {
      const { tenantPruneAction } = await import("~/services/ai/tenant-edit-history-route.server");
      return tenantPruneAction(request, peek.projectId, typeof peek.orgId === "string" ? peek.orgId : undefined);
    }
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const settings = await getSettings(
    validTokens.accessToken,
    validTokens.rootFolderId
  );

  try {
    const result = await prune(
      validTokens.accessToken,
      validTokens.rootFolderId,
      settings.editHistory
    );
    return Response.json(
      {
        deletedCount: result.deletedCount,
        remainingEntries: result.remainingEntries,
        totalFiles: result.totalFiles,
      },
      { headers: responseHeaders }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Prune failed" },
      { status: 500, headers: responseHeaders }
    );
  }
}
