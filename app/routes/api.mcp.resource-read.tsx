import type { Route } from "./+types/api.mcp.resource-read";
import { requireAuth } from "~/services/session.server";
import { getOrCreateClient } from "~/services/mcp-tools.server";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import type { McpServerConfig } from "~/types/settings";

/**
 * Server-side proxy for reading MCP resources (used by McpAppRenderer as fallback).
 * Reuses cached MCP clients to avoid re-initializing on every request (prevents 429).
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  await requireAuth(request);

  const body = await request.json();
  const { serverUrl, serverHeaders, resourceUri } = body as {
    serverUrl: string;
    serverHeaders?: Record<string, string>;
    resourceUri: string;
  };

  if (!serverUrl || !resourceUri) {
    return Response.json(
      { error: "serverUrl and resourceUri are required" },
      { status: 400 }
    );
  }

  try {
    validateMcpServerUrl(serverUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid server URL" },
      { status: 400 }
    );
  }

  try {
    const config: McpServerConfig = {
      name: "mcp-resource-proxy",
      url: serverUrl,
      headers: serverHeaders,
    };

    const client = await getOrCreateClient(config);
    const resource = await client.readResource(resourceUri);

    if (!resource) {
      return Response.json({ error: "Resource not found" }, { status: 404 });
    }

    return Response.json(resource);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Resource read failed" },
      { status: 500 }
    );
  }
}
