import type { WorkflowNode, ExecutionContext, FileExplorerData, ServiceContext } from "../types";
import { replaceVariables } from "./utils";

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

export async function handleHttpNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext?: ServiceContext
): Promise<void> {
  const url = replaceVariables(node.properties["url"] || "", context);
  const method = replaceVariables(node.properties["method"] || "GET", context).toUpperCase();
  const contentType = replaceVariables(node.properties["contentType"] || "json", context);

  if (!url) throw new Error("HTTP node missing 'url' property");

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
              ? Buffer.from(fileData.data, "base64")
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
      // Parse body as FileExplorerData, decode base64, send with mimeType
      const resolved = replaceVariables(bodyStr, context);
      const fileData = tryParseFileExplorerData(resolved);
      if (fileData && fileData.contentType === "binary") {
        body = Buffer.from(fileData.data, "base64");
        if (!headers["Content-Type"]) headers["Content-Type"] = fileData.mimeType;
      } else {
        // Try as raw variable reference
        const varVal = context.variables.get(resolved);
        if (varVal && typeof varVal === "string") {
          const varFileData = tryParseFileExplorerData(varVal);
          if (varFileData && varFileData.contentType === "binary") {
            body = Buffer.from(varFileData.data, "base64");
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
    let requestSignal: AbortSignal = timeoutSignal;
    if (serviceContext?.abortSignal) {
      requestSignal = AbortSignal.any
        ? AbortSignal.any([timeoutSignal, serviceContext.abortSignal])
        : timeoutSignal;
    }

    const requestOptions: RequestInit = {
      method,
      headers,
      signal: requestSignal,
    };
    if (body && ["POST", "PUT", "PATCH"].includes(method)) {
      requestOptions.body = body;
    }
    response = await fetch(url, requestOptions);
  } catch (err) {
    if (serviceContext?.abortSignal?.aborted) {
      throw new Error("Execution cancelled");
    }
    throw new Error(`HTTP request failed: ${method} ${url} - ${err instanceof Error ? err.message : String(err)}`);
  }

  const saveStatus = node.properties["saveStatus"];
  if (saveStatus) context.variables.set(saveStatus, response.status);

  if (response.status >= 400 && replaceVariables(node.properties["throwOnError"] || "", context) === "true") {
    const responseText = await response.text();
    throw new Error(`HTTP ${response.status} ${method} ${url}: ${responseText}`);
  }

  // Determine response type: auto (default), text, or binary
  const responseType = replaceVariables(node.properties["responseType"] || "auto", context);
  const contentTypeHeader = response.headers.get("content-type") || "application/octet-stream";
  const mimeType = contentTypeHeader.split(";")[0].trim();
  const isBinary = responseType === "binary" ? true
    : responseType === "text" ? false
    : isBinaryMimeType(mimeType);
  const saveTo = node.properties["saveTo"];

  if (isBinary && saveTo) {
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");

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
