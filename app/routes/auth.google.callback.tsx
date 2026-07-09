import { redirect } from "react-router";
import type { Route } from "./+types/auth.google.callback";
import {
  exchangeCode,
  hasRequiredHubworkScopes,
  HUBWORK_SCOPES,
  refreshAccessToken,
} from "~/services/google-auth.server";
import { getSession, setTokens, commitSession } from "~/services/session.server";
import { ensureRootFolder } from "~/services/google-drive.server";
import { ensureSettingsFile } from "~/services/user-settings.server";

async function getGrantedScopes(accessToken: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) return "";
  const tokenInfo = await res.json();
  return typeof tokenInfo.scope === "string" ? tokenInfo.scope : "";
}

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

  // PKCE: retrieve code_verifier from session
  const codeVerifier = stateSession.get("oauthCodeVerifier");
  if (!codeVerifier) {
    throw new Response("Missing PKCE code verifier", { status: 400 });
  }
  const requestedHubworkScopes = stateSession.get("oauthIncludeHubworkScopes") === "1";

  const tokens = await exchangeCode(code, request, codeVerifier);

  // Capture granted scopes from the callback
  const scope = url.searchParams.get("scope") || "";

  // Ensure root folder and settings.json exist on Drive
  const rootFolderId = await ensureRootFolder(tokens.accessToken);
  await ensureSettingsFile(tokens.accessToken, rootFolderId);

  // Fetch user email from Drive API
  let email: string | undefined;
  try {
    const aboutRes = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    if (aboutRes.ok) {
      const about = await aboutRes.json();
      email = about.user?.emailAddress;
    }
  } catch { /* non-critical */ }

  // Read returnTo before setTokens (which creates a new session)
  const returnTo = stateSession.get("oauthReturnTo") || "/";

  const hasHubworkScopes = hasRequiredHubworkScopes(scope);
  try {
    const {
      getAccountByRootFolderId,
      getAccountByEmail,
      getStoredRefreshToken,
      updateRefreshToken,
      updateAccount,
    } = await import("~/services/hubwork-accounts.server");
    let hubworkAccount = await getAccountByRootFolderId(rootFolderId);
    let hubworkAccountMatchedByEmail = false;
    if (!hubworkAccount && email) {
      hubworkAccount = await getAccountByEmail(email);
      hubworkAccountMatchedByEmail = !!hubworkAccount;
    }

    if (hubworkAccount?.plan) {
      const updates: Record<string, string> = {};
      if (hubworkAccountMatchedByEmail && rootFolderId && hubworkAccount.rootFolderId !== rootFolderId) {
        updates.rootFolderId = rootFolderId;
      }
      if (!hubworkAccount.email && email) updates.email = email;
      if (Object.keys(updates).length > 0) {
        await updateAccount(hubworkAccount.id, updates);
      }

      if (hasHubworkScopes && tokens.refreshToken) {
        await updateRefreshToken(hubworkAccount.id, tokens.refreshToken);
      } else {
        const storedRefreshToken = getStoredRefreshToken(hubworkAccount);
        if (storedRefreshToken) {
          try {
            const refreshed = await refreshAccessToken(storedRefreshToken);
            const storedScopes = await getGrantedScopes(refreshed.accessToken);
            if (!hasRequiredHubworkScopes(storedScopes)) {
              throw new Error("Stored refresh token is missing Hubwork scopes");
            }
            const session = await setTokens(request, {
              accessToken: refreshed.accessToken,
              refreshToken: storedRefreshToken,
              expiryTime: refreshed.expiryTime,
              rootFolderId: hubworkAccount.rootFolderId || rootFolderId,
              email: hubworkAccount.email || email,
              grantedScopes: storedScopes || HUBWORK_SCOPES.join(" "),
            });
            const updates: Record<string, string> = {};
            if (!hubworkAccount.rootFolderId && rootFolderId) updates.rootFolderId = rootFolderId;
            if (!hubworkAccount.email && email) updates.email = email;
            if (Object.keys(updates).length > 0) {
              updateAccount(hubworkAccount.id, updates).catch(() => {});
            }
            return redirect(returnTo, {
              headers: {
                "Set-Cookie": await commitSession(session),
              },
            });
          } catch {
            // Stored token was revoked/expired; fall through to scope upgrade.
          }
        }

        if (!requestedHubworkScopes) {
          const upgradeUrl = new URL("/auth/google", url.origin);
          upgradeUrl.searchParams.set("hubwork", "1");
          upgradeUrl.searchParams.set("returnTo", returnTo);
          return redirect(`${upgradeUrl.pathname}${upgradeUrl.search}`);
        }
      }
    }
  } catch {
    // Hubwork account lookup/update is not required for normal login.
  }

  const session = await setTokens(request, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiryTime: tokens.expiryTime,
    rootFolderId,
    email,
    grantedScopes: scope,
  });

  return redirect(returnTo, {
    headers: {
      "Set-Cookie": await commitSession(session),
    },
  });
}
