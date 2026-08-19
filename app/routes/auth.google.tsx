import { redirect } from "react-router";
import type { Route } from "./+types/auth.google";
import { getAuthUrl } from "~/services/google-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const reqUrl = new URL(request.url);
  // Ask for the Gmail/Calendar scopes during the ordinary sign-in: features
  // that need them (organization invitation emails, calendar, Gmail nodes)
  // otherwise fail later with an opaque 403 and force a second consent round.
  // `?hubwork=1` stays supported for the explicit re-consent links.
  const hubworkEntry = reqUrl.searchParams.get("hubwork") === "1";
  const returnTo = reqUrl.searchParams.get("returnTo") || (hubworkEntry ? "/settings?hubwork_upgraded=1" : undefined);
  const { url, setCookieHeader } = await getAuthUrl(request, {
    includeHubworkScopes: true,
    returnTo,
  });
  return redirect(url, {
    headers: { "Set-Cookie": setCookieHeader },
  });
}
