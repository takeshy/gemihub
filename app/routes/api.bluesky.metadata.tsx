import { blueskyMetadata } from "~/services/bluesky.server";
export function loader() { try { return Response.json(blueskyMetadata(), { headers: { "Cache-Control": "public, max-age=300" } }); } catch { return Response.json({ error: "Bluesky is not configured" }, { status: 503 }); } }
