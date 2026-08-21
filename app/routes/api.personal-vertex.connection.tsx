import type { Route } from "./+types/api.personal-vertex.connection";
import { requireAuth } from "~/services/session.server";
import { emailToUid } from "~/services/organizations.server";
import { disconnectVertexOAuth, getUserVertexOAuthStatus } from "~/services/vertex-oauth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const uid = emailToUid(tokens.email ?? "");
  if (!uid) return Response.json({ error: "signed-in email required" }, { status: 403 });
  return Response.json({ oauthStatus: await getUserVertexOAuthStatus(uid) });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "DELETE") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const tokens = await requireAuth(request);
  const uid = emailToUid(tokens.email ?? "");
  if (!uid) return Response.json({ error: "signed-in email required" }, { status: 403 });
  await disconnectVertexOAuth({ scope: "user", uid });
  return Response.json({ ok: true });
}
