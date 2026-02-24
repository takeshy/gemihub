import type { Route } from "./+types/api.settings.mcp-test";
import { requireAuth } from "~/services/session.server";
import { McpClient, McpHttpError } from "~/services/mcp-client.server";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import {
  discoverOAuth,
  registerOAuthClient,
  refreshAccessToken,
  isTokenExpired,
} from "~/services/mcp-oauth.server";
import type { OAuthConfig, OAuthTokens } from "~/types/settings";

// ---------------------------------------------------------------------------
// POST -- Test MCP server connection
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  await requireAuth(request);

  const body = await request.json();
  const { url, headers, oauth, oauthTokens, origin } = body as {
    url: string;
    headers?: Record<string, string>;
    oauth?: OAuthConfig;
    oauthTokens?: OAuthTokens;
    origin?: string;
  };

  if (!url) {
    return Response.json(
      { error: "URL is required" },
      { status: 400 }
    );
  }

  try {
    validateMcpServerUrl(url);
  } catch (error) {
    return Response.json(
      { success: false, message: error instanceof Error ? error.message : "Invalid URL", error: "SSRF blocked" },
      { status: 400 }
    );
  }

  // If we have tokens, check expiry and auto-refresh if possible
  let activeTokens = oauthTokens;
  let tokensRefreshed = false;

  if (activeTokens && oauth && isTokenExpired(activeTokens)) {
    if (activeTokens.refreshToken) {
      try {
        activeTokens = await refreshAccessToken(oauth, activeTokens.refreshToken);
        tokensRefreshed = true;
      } catch {
        // Refresh failed, try with current tokens anyway
      }
    }
  }

  // Build effective headers with OAuth Authorization if available
  const effectiveHeaders: Record<string, string> = { ...headers };
  if (activeTokens) {
    effectiveHeaders["Authorization"] = `Bearer ${activeTokens.accessToken}`;
  }

  const client = new McpClient({
    name: "test",
    url,
    headers: effectiveHeaders,
  });

  try {
    await client.initialize();
    const tools = await client.listTools();

    await client.close();

    const result: Record<string, unknown> = {
      success: true,
      message: `Connected. Found ${tools.length} tool(s).`,
      tools,
    };

    if (tokensRefreshed && activeTokens) {
      result.tokens = activeTokens;
    }

    return Response.json(result);
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }

    // Check if this is a 401 — attempt OAuth discovery
    const errorMsg = error instanceof Error ? error.message : "Connection failed";
    const is401 = error instanceof McpHttpError && error.statusCode === 401;

    if (is401) {
      try {
        const discovery = await discoverOAuth(url);
        if (discovery) {
          // Attempt dynamic client registration if available and no clientId yet
          if (discovery.registrationUrl && !discovery.config.clientId) {
            try {
              const fallbackUrl = new URL(request.url);
              const fallbackProto = request.headers.get("x-forwarded-proto") || fallbackUrl.protocol.replace(":", "");
              const effectiveOrigin = origin || `${fallbackProto}://${fallbackUrl.host}`;
              const redirectUri = `${effectiveOrigin}/auth/mcp-oauth-callback`;
              const registration = await registerOAuthClient(
                discovery.registrationUrl,
                redirectUri,
                "GemiHub"
              );
              discovery.config.clientId = registration.clientId;
              if (registration.clientSecret) {
                discovery.config.clientSecret = registration.clientSecret;
              }
            } catch {
              // Dynamic registration failed — use fixed clientId as fallback
              discovery.config.clientId = "gemihub";
            }
          }

          // If no registration endpoint was available, use fixed clientId
          if (!discovery.config.clientId) {
            discovery.config.clientId = "gemihub";
          }

          return Response.json({
            success: false,
            needsOAuth: true,
            oauthDiscovery: discovery,
            message: "Server requires OAuth authentication.",
          });
        }
      } catch {
        // Discovery failed, return original error
      }
    }

    return Response.json(
      {
        success: false,
        message: errorMsg,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
