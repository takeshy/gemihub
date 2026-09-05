/**
 * GET    /api/personal-vertex/connection → status of the user's own Vertex connection
 * POST   /api/personal-vertex/connection → store the user's Web-application OAuth client JSON
 * DELETE /api/personal-vertex/connection → disconnect (revoke + forget the refresh token)
 *
 * "My Google Cloud project" mirrors the desktop app: the user uploads an OAuth
 * client from their own project first, then runs the Google consent flow with
 * that client (`/auth/vertex/start?personal=1`). Uploading a new client drops
 * any existing connection because the refresh token is bound to the issuer.
 */
import type { Route } from "./+types/api.personal-vertex.connection";
import { requireAuth } from "~/services/session.server";
import { emailToUid } from "~/services/organizations.server";
import {
  disconnectVertexOAuth,
  getUserVertexOAuthStatus,
  parseVertexOAuthClientInput,
  saveVertexOAuthClient,
} from "~/services/vertex-oauth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const uid = emailToUid(tokens.email ?? "");
  if (!uid) return Response.json({ error: "signed-in email required" }, { status: 403 });
  return Response.json({ oauthStatus: await getUserVertexOAuthStatus(uid) });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "DELETE" && request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const tokens = await requireAuth(request);
  const uid = emailToUid(tokens.email ?? "");
  if (!uid) return Response.json({ error: "signed-in email required" }, { status: 403 });

  if (request.method === "POST") {
    const body = await request.json().catch(() => null) as {
      clientId?: unknown;
      clientSecret?: unknown;
      projectId?: unknown;
      redirectUris?: unknown;
    } | null;
    if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });
    const parsed = parseVertexOAuthClientInput(body, request);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    await saveVertexOAuthClient({ scope: "user", uid }, parsed.input);
    return Response.json({ ok: true, oauthStatus: await getUserVertexOAuthStatus(uid) });
  }

  await disconnectVertexOAuth({ scope: "user", uid });
  return Response.json({ ok: true, oauthStatus: await getUserVertexOAuthStatus(uid) });
}
