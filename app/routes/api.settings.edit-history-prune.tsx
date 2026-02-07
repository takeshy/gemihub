import type { Route } from "./+types/api.settings.edit-history-prune";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { prune } from "~/services/edit-history.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
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
      { message: `Pruned ${result.deletedCount} entries.` },
      { headers: responseHeaders }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Prune failed" },
      { status: 500, headers: responseHeaders }
    );
  }
}
