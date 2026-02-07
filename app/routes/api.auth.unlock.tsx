import type { Route } from "./+types/api.auth.unlock";
import { requireAuth, getSession, commitSession, setGeminiApiKey } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { decryptPrivateKey } from "~/services/crypto-core";

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  const { password } = await request.json();
  if (!password || !settings.encryptedApiKey || !settings.apiKeySalt) {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: responseHeaders });
  }

  try {
    const apiKey = await decryptPrivateKey(settings.encryptedApiKey, settings.apiKeySalt, password);
    const keySession = await setGeminiApiKey(request, apiKey);
    const session = await getSession(request);
    session.set("geminiApiKey", keySession.get("geminiApiKey"));
    const headers = new Headers({
      "Content-Type": "application/json",
      "Set-Cookie": await commitSession(session),
    });
    if (setCookieHeader) headers.append("Set-Cookie", setCookieHeader);
    return new Response(JSON.stringify({ success: true }), { headers });
  } catch {
    return Response.json({ error: "Incorrect password" }, { status: 401, headers: responseHeaders });
  }
}
