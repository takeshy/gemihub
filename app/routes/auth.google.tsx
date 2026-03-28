import { redirect } from "react-router";
import type { Route } from "./+types/auth.google";
import { getAuthUrl } from "~/services/google-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const reqUrl = new URL(request.url);
  const includeHubworkScopes = reqUrl.searchParams.get("hubwork") === "1";
  const { url, setCookieHeader } = await getAuthUrl(request, { includeHubworkScopes });
  return redirect(url, {
    headers: { "Set-Cookie": setCookieHeader },
  });
}
