import type { Route } from "./+types/hubwork.internal.auth.verify.$token";
import { verifyMagicToken } from "~/services/hubwork-magic-link.server";
import { createContactSession } from "~/services/hubwork-session.server";
import { validateRedirectUrl } from "~/utils/security";

export async function loader({ request, params }: Route.LoaderArgs) {
  // Return 200 for HEAD requests without consuming the token.
  // This prevents email client link scanners from invalidating tokens.
  if (request.method === "HEAD") {
    return new Response(null, { status: 200 });
  }

  const token = params.token;
  if (!token) {
    throw new Response("Invalid token", { status: 400 });
  }

  const result = await verifyMagicToken(token);
  if (!result) {
    throw new Response("Token is invalid or expired", { status: 401 });
  }

  const url = new URL(request.url);
  const redirectPath = validateRedirectUrl(url.searchParams.get("redirect"), "/");

  return createContactSession(result.email, result.type, redirectPath);
}
