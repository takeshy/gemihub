import type { Route } from "./+types/api.session.me";
import { getTokens } from "~/services/session.server";

/**
 * Returns the logged-in user's Google email.
 *
 * Used by the IDE admin preview to display "signed in as" in admin pages and
 * to cache a session marker in `window.gemihub.auth.me()` so admin pages
 * that defensively call `require()` don't redirect. The email is *not* the
 * authentication boundary — the admin workflow endpoint is. This is just a
 * display helper.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens?.email) {
    return Response.json({ email: null }, { status: 401 });
  }
  return Response.json(
    { email: tokens.email },
    { headers: { "Cache-Control": "no-store" } },
  );
}
