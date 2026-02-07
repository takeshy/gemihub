import type { Route } from "./+types/api.settings.mcp-oauth-token";
import { requireAuth } from "~/services/session.server";
import { exchangeCodeForTokens } from "~/services/mcp-oauth.server";
import { validateMcpServerUrl } from "~/services/url-validator.server";

// ---------------------------------------------------------------------------
// POST -- Exchange OAuth authorization code for tokens (server-side to avoid CORS)
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  await requireAuth(request);

  const body = await request.json();
  const { tokenUrl, clientId, clientSecret, code, codeVerifier, redirectUri } = body as {
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  };

  if (!tokenUrl || !clientId || !code || !codeVerifier || !redirectUri) {
    return Response.json(
      { error: "Missing required parameters" },
      { status: 400 }
    );
  }

  try {
    validateMcpServerUrl(tokenUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid token URL" },
      { status: 400 }
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(
      { clientId, authorizationUrl: "", tokenUrl, scopes: [], clientSecret },
      code,
      codeVerifier,
      redirectUri
    );

    return Response.json({ tokens });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Token exchange failed",
      },
      { status: 500 }
    );
  }
}
