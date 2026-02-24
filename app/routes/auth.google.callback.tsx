import { redirect } from "react-router";
import type { Route } from "./+types/auth.google.callback";
import { exchangeCode } from "~/services/google-auth.server";
import { getSession, setTokens, commitSession } from "~/services/session.server";
import { ensureRootFolder } from "~/services/google-drive.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code) {
    throw new Response("Missing authorization code", { status: 400 });
  }

  // Verify OAuth state parameter to prevent CSRF
  const stateSession = await getSession(request);
  const expectedState = stateSession.get("oauthState");
  if (!state || !expectedState || state !== expectedState) {
    throw new Response("Invalid OAuth state parameter", { status: 400 });
  }

  const tokens = await exchangeCode(code, request);

  // Ensure root folder exists on Drive
  const rootFolderId = await ensureRootFolder(tokens.accessToken);

  const session = await setTokens(request, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiryTime: tokens.expiryTime,
    rootFolderId,
  });

  return redirect("/", {
    headers: {
      "Set-Cookie": await commitSession(session),
    },
  });
}
