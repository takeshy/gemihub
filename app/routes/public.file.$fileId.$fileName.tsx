import type { Route } from "./+types/public.file.$fileId.$fileName";
import {
  PUBLIC_LINK_SIG_PARAM,
  isActivePublicExtension,
  verifyPublicFileSignature,
} from "~/services/public-link.server";

const DOWNLOAD_URL = "https://drive.usercontent.google.com/download";

export async function loader({ params, request }: Route.LoaderArgs) {
  const { fileId, fileName } = params;
  if (!fileId || !fileName) {
    return new Response("Missing fileId or fileName", { status: 400 });
  }

  // A signed link proves GemiHub minted it for a file its owner published.
  // Links published before signing existed carry no signature; they keep
  // working for passive content (embedded images and the like) but never for
  // content that can execute script on this origin.
  const signature = new URL(request.url).searchParams.get(PUBLIC_LINK_SIG_PARAM);
  const signed = verifyPublicFileSignature(fileId, signature);
  if (!signed && isActivePublicExtension(fileName)) {
    return new Response(
      "This public link is no longer valid. Re-publish the file in GemiHub to get a new link.",
      { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  try {
    const res = await fetch(
      `${DOWNLOAD_URL}?id=${fileId}&export=download`,
      { signal: AbortSignal.timeout(30_000), redirect: "follow" }
    );
    if (!res.ok) {
      return new Response(res.statusText, { status: res.status });
    }

    const contentType = guessContentType(fileName);

    return new Response(res.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
        // Served content renders and runs its own scripts, but from an opaque
        // origin: it cannot read this app's IndexedDB or call /api/* with the
        // viewer's cookies. `allow-same-origin` must never be added here.
        "Content-Security-Policy": signed
          ? "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          : "sandbox",
      },
    });
  } catch {
    return new Response("Failed to fetch file", { status: 502 });
  }
}

function guessContentType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    yaml: "text/yaml; charset=utf-8",
    yml: "text/yaml; charset=utf-8",
    csv: "text/csv; charset=utf-8",
  };
  return (ext && map[ext]) || "application/octet-stream";
}
