import type { Route } from "./+types/hubwork.internal.auth.logout";
import { destroyContactSession } from "~/services/hubwork-session.server";
import { validateOrigin } from "~/utils/security";

const ACCOUNT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

export async function action({ request }: Route.ActionArgs) {
  validateOrigin(request);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const type = (body.type as string || "").trim();

  if (!type || !ACCOUNT_TYPE_PATTERN.test(type)) {
    return Response.json({ error: "Valid account type is required" }, { status: 400 });
  }

  const setCookie = await destroyContactSession(request, type);
  return Response.json({ ok: true }, {
    headers: { "Set-Cookie": setCookie },
  });
}
