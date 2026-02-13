import type { Route } from "./+types/api.temp-edit.$uuid.$fileName";
import {
  readTempEditFile,
  updateTempEditContent,
} from "~/services/temp-edit-file.server";

const GET_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const PUT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 day
const MAX_PUT_BODY = 10 * 1024 * 1024; // 10 MB

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function guessContentType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    yaml: "text/yaml; charset=utf-8",
    yml: "text/yaml; charset=utf-8",
    csv: "text/csv; charset=utf-8",
  };
  // Serve all content as text/plain by default to prevent XSS (including html)
  return (ext && map[ext]) || "text/plain; charset=utf-8";
}

const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export async function loader({ params }: Route.LoaderArgs) {
  const { uuid, fileName } = params;
  if (!uuid || !fileName || !UUID_RE.test(uuid)) {
    return new Response("Bad request", { status: 400 });
  }

  const entry = readTempEditFile(uuid);
  if (!entry) {
    return new Response("Not found", { status: 404, headers: SAFE_HEADERS });
  }

  // Validate fileName matches stored entry
  if (entry.fileName !== fileName) {
    return new Response("Not found", { status: 404, headers: SAFE_HEADERS });
  }

  const age = Date.now() - new Date(entry.createdAt).getTime();
  if (age > GET_EXPIRY_MS) {
    return new Response("Gone — edit URL expired (30 min limit for GET)", {
      status: 410,
      headers: SAFE_HEADERS,
    });
  }

  const contentType = guessContentType(fileName);
  return new Response(entry.content, {
    headers: { "Content-Type": contentType, ...SAFE_HEADERS },
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "PUT") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { uuid, fileName } = params;
  if (!uuid || !fileName || !UUID_RE.test(uuid)) {
    return new Response("Bad request", { status: 400 });
  }

  // Body size check
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_PUT_BODY) {
    return new Response("Payload too large", { status: 413 });
  }

  const entry = readTempEditFile(uuid);
  if (!entry) {
    return new Response("Not found", { status: 404 });
  }

  // Validate fileName matches stored entry
  if (entry.fileName !== fileName) {
    return new Response("Not found", { status: 404 });
  }

  const age = Date.now() - new Date(entry.createdAt).getTime();
  if (age > PUT_EXPIRY_MS) {
    return new Response("Gone — edit URL expired (1 day limit for PUT)", {
      status: 410,
    });
  }

  const content = await request.text();
  if (content.length > MAX_PUT_BODY) {
    return new Response("Payload too large", { status: 413 });
  }
  updateTempEditContent(uuid, content);
  return new Response("OK", { status: 200 });
}
