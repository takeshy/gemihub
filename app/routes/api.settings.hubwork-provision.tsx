import type { Route } from "./+types/api.settings.hubwork-provision";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { provisionHubworkSkill } from "~/services/hubwork-skill-provisioner.server";

/**
 * POST /api/settings/hubwork-provision
 * Provisions Hubwork Web skill and returns created files for IndexedDB registration.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  try {
    const files = await provisionHubworkSkill(validTokens.accessToken, validTokens.rootFolderId);
    return Response.json({ files });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Provisioning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
