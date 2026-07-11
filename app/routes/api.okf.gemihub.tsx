import { requireAuth } from "~/services/session.server";
import {
  fetchGemihubOkfBundle,
  fetchGemihubOkfManifest,
} from "~/services/gemihub-okf.server";

export async function loader({ request }: { request: Request }) {
  await requireAuth(request);
  try {
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") ?? "manifest";
    const manifest = await fetchGemihubOkfManifest();
    if (!manifest) {
      return Response.json({ available: false }, { status: 404 });
    }
    if (resource === "manifest") {
      return Response.json({ available: true, manifest }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (resource !== "bundle") {
      return Response.json({ error: "Unknown resource" }, { status: 400 });
    }
    const requestedVersion = url.searchParams.get("version");
    if (requestedVersion !== manifest.version) {
      return Response.json({ error: "GemiHub OKF version changed; refresh the manifest" }, { status: 409 });
    }
    const bytes = await fetchGemihubOkfBundle(manifest);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch GemiHub OKF";
    return Response.json({ error: message }, { status: 502 });
  }
}
