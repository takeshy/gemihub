import { validateOrigin } from "~/utils/security";
import type { Route } from "./+types/api.bluesky";
import { requireAuth } from "~/services/session.server";
import { blueskyOwner, blueskyClient, blueskyStorage, getBlueskyConnection, disconnectBluesky, publishBluesky } from "~/services/bluesky.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const connection = await getBlueskyConnection(blueskyOwner(tokens));
  return Response.json({ connected: !!connection, ...connection }, { headers: { "Cache-Control": "no-store" } });
}
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  validateOrigin(request);
  const tokens = await requireAuth(request);
  const headers = { "Cache-Control": "no-store" };
  try {
    const raw = await request.text();
    if (raw.length > 12_000_000) throw new Error("Publication too large");
    const body = JSON.parse(raw);
    const owner = blueskyOwner(tokens);
    if (body.operation === "connect") {
      if (typeof body.handle !== "string" || body.handle.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(body.handle) || !body.handle.includes(".")) throw new Error("Invalid handle");
      const url = await blueskyStorage(owner).lock("account", () => blueskyClient(owner).authorize(body.handle));
      return Response.json({ url: url.toString() }, { headers });
    }
    if (body.operation === "disconnect") { await disconnectBluesky(owner); return Response.json({ ok: true }, { headers }); }
    if (body.operation === "publish") { return Response.json(await publishBluesky(owner, body.posts, body.did), { headers }); }
    return Response.json({ error: "Invalid operation" }, { status: 400, headers });
  } catch (error) {
    const detail = error as { error?: string; status?: number; message?: string };
    console.error("[bluesky] request failed:", detail?.status ?? "", detail?.error ?? "", detail?.message ?? error);
    // SDK errors can contain auth URLs. Keep credentials out of browser output.
    return Response.json({ error: "Bluesky operation failed. Check your connection and retry the same selection to verify any pending publication." }, { status: 400, headers });
  }
}
