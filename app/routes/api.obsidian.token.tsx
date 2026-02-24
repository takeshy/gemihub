import type { Route } from "./+types/api.obsidian.token";
import { refreshAccessToken } from "~/services/google-auth.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { refreshToken?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { refreshToken } = body;
  if (!refreshToken || typeof refreshToken !== "string") {
    return Response.json({ error: "refreshToken is required" }, { status: 400 });
  }

  try {
    const { accessToken, expiryTime } = await refreshAccessToken(refreshToken);
    const expiresIn = Math.floor((expiryTime - Date.now()) / 1000);
    return Response.json({
      access_token: accessToken,
      expires_in: expiresIn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token refresh failed";
    return Response.json({ error: message }, { status: 401 });
  }
}
