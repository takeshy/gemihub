/**
 * GET /api/auth/api-key
 *
 * Hands the browser the Gemini API key already held by this session. The key
 * is decrypted once, when the user unlocks it with their password
 * (`/api/auth/unlock` stores it in the 30-day session cookie); before this
 * route, the browser kept its own copy only in memory, so free-plan chat and
 * local workflow execution asked for the password again after every reload
 * even though the server still had the key. Nothing new is persisted: the
 * response is served only to a session that already contains the key.
 */
import type { Route } from "./+types/api.auth.api-key";
import { requireAuth } from "~/services/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  // The session cookie is SameSite=Lax, so a cross-site fetch never carries it
  // and a cross-site reader could not read the body without CORS headers. This
  // check additionally refuses the one request shape Lax still allows — a
  // top-level navigation to this URL — so the key cannot land in the browser's
  // history or a screenshot from a link someone else supplied.
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const tokens = await requireAuth(request);
  const apiKey = tokens.geminiApiKey || null;
  return Response.json(
    { apiKey },
    { status: apiKey ? 200 : 404, headers: { "Cache-Control": "no-store" } },
  );
}
