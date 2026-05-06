import type { Route } from "./+types/api.google.picker";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, sessionTokens);
  const headers = new Headers({
    "Cache-Control": "no-store",
  });
  if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);

  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const appId = process.env.GOOGLE_PICKER_APP_ID || clientId.split("-")[0] || "";
  const developerKey = process.env.GOOGLE_PICKER_API_KEY || process.env.GOOGLE_API_KEY || "";

  return Response.json(
    {
      accessToken: validTokens.accessToken,
      appId,
      developerKey,
    },
    { headers }
  );
}
