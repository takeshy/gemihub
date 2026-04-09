import type { Route } from "./+types/api.auth.picker-token";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";

/**
 * GET /api/auth/picker-token
 * Returns a short-lived OAuth access token for the Google Picker API.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  return Response.json({
    accessToken: validTokens.accessToken,
  });
}
