/**
 * Browser-compatible HTTP node handler.
 * Equivalent to handlers/http.ts but uses base64 utilities instead of Buffer.
 */
import type { WorkflowNode, ExecutionContext, FileExplorerData } from "../types";
import { replaceVariables } from "../handlers/utils";
import { base64Decode, base64Encode } from "~/utils/base64";

function tryParseFileExplorerData(value: string): FileExplorerData | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "contentType" in parsed && "data" in parsed && "mimeType" in parsed) {
      return parsed as FileExplorerData;
    }
  } catch { /* not JSON */ }
  return null;
}

function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const types: Record<string, string> = {
    html: "text/html", htm: "text/html", txt: "text/plain",
    json: "application/json", xml: "application/xml", css: "text/css",
    js: "application/javascript", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", pdf: "application/pdf",
  };
  return types[ext || ""] || "application/octet-stream";
}

function isBinaryMimeType(mimeType: string): boolean {
  if (mimeType.startsWith("text/")) return false;
  if (mimeType === "application/json" || mimeType === "application/xml" ||
      mimeType === "application/javascript") return false;
  if (mimeType.endsWith("+xml") || mimeType.endsWith("+json")) return false;
  if (mimeType.startsWith("image/") || mimeType.startsWith("audio/") ||
      mimeType.startsWith("video/")) return true;
  if (mimeType === "application/pdf" || mimeType === "application/zip" ||
      mimeType === "application/octet-stream") return true;
  return false;
}

function getMimeExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
    "image/webp": "webp", "application/pdf": "pdf", "application/json": "json",
  };
  return map[mimeType] || "";
}

export async function handleHttpNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
  abortSignal?: AbortSignal,
  canUseProxy?: boolean,
): Promise<void> {
  const url = replaceVariables(node.properties["url"] || "", context);
  const method = replaceVariables(node.properties["method"] || "GET", context).toUpperCase();
  const contentType = replaceVariables(node.properties["contentType"] || "json", context);

  if (!url) throw new Error("HTTP node missing 'url' property");

  // Validate URL scheme
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported URL scheme: ${parsed.protocol} (only http/https allowed)`);
    }
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`Invalid URL: ${url}`);
    }
    throw e;
  }

  const headers: Record<string, string> = {};

  const headersStr = node.properties["headers"];
  if (headersStr) {
    const replacedHeaders = replaceVariables(headersStr, context);
    try {
      Object.assign(headers, JSON.parse(replacedHeaders));
    } catch {
      const lines = replacedHeaders.split("\n");
      for (const line of lines) {
        const colonIndex = line.indexOf(":");
        if (colonIndex !== -1) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          if (key) headers[key] = value;
        }
      }
    }
  }

  let body: BodyInit | undefined;
  const bodyStr = node.properties["body"];

  if (bodyStr && ["POST", "PUT", "PATCH"].includes(method)) {
    if (contentType === "form-data") {
      try {
        const rawFields = JSON.parse(bodyStr);
        const formData = new FormData();
        for (const [key, value] of Object.entries(rawFields)) {
          const resolvedKey = replaceVariables(key, context);
          const resolvedValue = replaceVariables(String(value), context);
          const fileData = tryParseFileExplorerData(resolvedValue);

          const colonIndex = resolvedKey.indexOf(":");
          const fieldName = colonIndex !== -1 ? resolvedKey.substring(0, colonIndex) : resolvedKey;

          if (fileData) {
            const fileBuffer = fileData.contentType === "binary"
              ? base64Decode(fileData.data).buffer as ArrayBuffer
              : fileData.data;
            const fileBlob = new Blob([fileBuffer], { type: fileData.mimeType });
            formData.append(fieldName, fileBlob, fileData.basename);
          } else if (colonIndex !== -1) {
            const filename = resolvedKey.substring(colonIndex + 1);
            const mimeType = guessContentType(filename);
            const fileBlob = new Blob([resolvedValue], { type: mimeType });
            formData.append(fieldName, fileBlob, filename);
          } else {
            formData.append(fieldName, resolvedValue);
          }
        }
        body = formData;
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === "content-type") {
            delete headers[key];
          }
        }
      } catch {
        throw new Error("form-data contentType requires valid JSON object body");
      }
    } else if (contentType === "binary") {
      const resolved = replaceVariables(bodyStr, context);
      const fileData = tryParseFileExplorerData(resolved);
      if (fileData && fileData.contentType === "binary") {
        body = base64Decode(fileData.data).buffer as ArrayBuffer;
        if (!headers["Content-Type"]) headers["Content-Type"] = fileData.mimeType;
      } else {
        const varVal = context.variables.get(resolved);
        if (varVal && typeof varVal === "string") {
          const varFileData = tryParseFileExplorerData(varVal);
          if (varFileData && varFileData.contentType === "binary") {
            body = base64Decode(varFileData.data).buffer as ArrayBuffer;
            if (!headers["Content-Type"]) headers["Content-Type"] = varFileData.mimeType;
          } else {
            throw new Error("binary contentType requires FileExplorerData with contentType: 'binary'");
          }
        } else {
          throw new Error("binary contentType requires FileExplorerData body");
        }
      }
    } else if (contentType === "text") {
      body = replaceVariables(bodyStr, context);
      if (!headers["Content-Type"]) headers["Content-Type"] = "text/plain";
    } else {
      body = replaceVariables(bodyStr, context);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
  }

  let response: Response;
  try {
    const timeoutSignal = AbortSignal.timeout(60_000);
    let requestSignal: AbortSignal;
    if (!abortSignal) {
      requestSignal = timeoutSignal;
    } else if (typeof AbortSignal.any === "function") {
      requestSignal = AbortSignal.any([timeoutSignal, abortSignal]);
    } else {
      // Polyfill for browsers without AbortSignal.any
      const combined = new AbortController();
      const onAbort = () => combined.abort();
      timeoutSignal.addEventListener("abort", onAbort, { once: true });
      abortSignal.addEventListener("abort", onAbort, { once: true });
      if (abortSignal.aborted || timeoutSignal.aborted) combined.abort();
      requestSignal = combined.signal;
    }

    const requestOptions: RequestInit = {
      method,
      headers,
      signal: requestSignal,
    };
    if (body && ["POST", "PUT", "PATCH"].includes(method)) {
      requestOptions.body = body;
    }

    // Cross-origin requests in the browser are blocked by CORS when the
    // target has no Access-Control-Allow-Origin header. For public URL
    // fetches (common in skill workflows like OGP scraping), route through
    // the server proxy so the request actually succeeds. Same-origin
    // requests go direct to keep local/auth-cookie flows unchanged.
    //
    // Non-Premium users skip the proxy entirely — the server rejects the
    // call with 403, so attempting it wastes a round-trip. Cross-origin
    // targets without CORS headers will fail, which is the intended
    // behavior outside the Premium plan.
    const targetOrigin = (() => {
      try { return new URL(url).origin; } catch { return ""; }
    })();
    const needsProxy = canUseProxy === true && targetOrigin !== "" && targetOrigin !== window.location.origin;

    if (needsProxy) {
      // body can be FormData/Blob for multipart uploads; the proxy only
      // accepts JSON-serializable bodies, so we force same-origin fetch for
      // those cases even if cross-origin.
      const bodyIsJsonSafe = body === undefined || typeof body === "string";
      if (bodyIsJsonSafe) {
        response = await fetch("/api/workflow/http-fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, method, headers, body }),
          signal: requestSignal,
        });
      } else {
        response = await fetch(url, requestOptions);
      }
    } else {
      response = await fetch(url, requestOptions);
    }
  } catch (err) {
    if (abortSignal?.aborted) throw new Error("Execution cancelled");
    throw new Error(`HTTP request failed: ${method} ${url} - ${err instanceof Error ? err.message : String(err)}`);
  }

  const saveStatus = node.properties["saveStatus"];
  if (saveStatus) context.variables.set(saveStatus, response.status);

  // Default to throwing on HTTP 4xx/5xx so failures surface to the chat AI
  // and the user (and the "Open workflow" recovery UI for skill workflows).
  // Set `throwOnError: "false"` explicitly to opt into silent handling.
  const throwOnErrorProp = replaceVariables(
    node.properties["throwOnError"] || "true",
    context,
  );
  if (response.status >= 400 && throwOnErrorProp !== "false") {
    const responseText = await response.text();
    throw new Error(`HTTP ${response.status} ${method} ${url}: ${responseText}`);
  }

  const responseType = replaceVariables(node.properties["responseType"] || "auto", context);
  const contentTypeHeader = response.headers.get("content-type") || "application/octet-stream";
  const mimeType = contentTypeHeader.split(";")[0].trim();
  const isBinary = responseType === "binary" ? true
    : responseType === "text" ? false
    : isBinaryMimeType(mimeType);
  const saveTo = node.properties["saveTo"];

  if (isBinary && saveTo) {
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = base64Encode(arrayBuffer);

    let basename = "download";
    let extension = "";
    try {
      const urlPath = new URL(url).pathname;
      const urlBasename = urlPath.split("/").pop();
      if (urlBasename && urlBasename.includes(".")) {
        basename = urlBasename;
        extension = urlBasename.split(".").pop() || "";
      }
    } catch { /* URL parsing failed */ }

    if (!extension) {
      extension = getMimeExtension(mimeType);
      if (extension) basename = `download.${extension}`;
    }

    const name = basename.includes(".") ? basename.substring(0, basename.lastIndexOf(".")) : basename;

    const fileData: FileExplorerData = {
      path: "", basename, name, extension, mimeType,
      contentType: "binary", data: base64Data,
    };
    context.variables.set(saveTo, JSON.stringify(fileData));
  } else if (saveTo) {
    const responseText = await response.text();
    try {
      const jsonData = JSON.parse(responseText);
      context.variables.set(saveTo, JSON.stringify(jsonData));
    } catch {
      context.variables.set(saveTo, responseText);
    }
  }
}
