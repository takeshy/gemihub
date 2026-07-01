import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  fetchExternalSkillCatalog,
  importExternalSkill,
} from "~/services/external-skills.server";

export async function loader({ request }: { request: Request }) {
  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  try {
    const catalog = await fetchExternalSkillCatalog(
      validTokens.accessToken,
      validTokens.rootFolderId,
    );
    return Response.json({ catalog });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load external skills";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  try {
    const body = await request.json() as { skillId?: unknown; force?: unknown };
    if (typeof body.skillId !== "string" || !body.skillId.trim()) {
      return Response.json({ error: "skillId is required" }, { status: 400 });
    }
    const result = await importExternalSkill(
      validTokens.accessToken,
      validTokens.rootFolderId,
      body.skillId.trim(),
      body.force === true,
    );
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to import external skill";
    return Response.json({ error: message }, { status: 500 });
  }
}
