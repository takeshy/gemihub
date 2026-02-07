import type { Route } from "./+types/api.settings.edit-history-stats";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getStats } from "~/services/edit-history.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  try {
    const stats = await getStats(
      validTokens.accessToken,
      validTokens.rootFolderId
    );
    return Response.json(stats, { headers: responseHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get stats" },
      { status: 500, headers: responseHeaders }
    );
  }
}
