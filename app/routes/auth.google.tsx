import { redirect } from "react-router";
import type { Route } from "./+types/auth.google";
import { getAuthUrl } from "~/services/google-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const { url, setCookieHeader } = await getAuthUrl(request);
  return redirect(url, {
    headers: { "Set-Cookie": setCookieHeader },
  });
}
