import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { provisionGemihubSkills } from "~/services/gemihub-skill-provisioner.server";

/**
 * POST /api/settings/gemihub-skills-provision
 * Ensures built-in GemiHub skills are present as normal Drive-backed skills.
 */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  try {
    const body = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : {};
    const force = body?.force === true;
    const result = await provisionGemihubSkills(
      validTokens.accessToken,
      validTokens.rootFolderId,
      force,
    );
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Provisioning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
