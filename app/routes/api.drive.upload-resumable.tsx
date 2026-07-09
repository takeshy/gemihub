import type { Route } from "./+types/api.drive.upload-resumable";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  createResumableUploadSession,
  getFileMetadata,
  uploadResumableFile,
  updateResumableUploadSession,
} from "~/services/google-drive.server";
import { upsertFileInMeta } from "~/services/sync-meta.server";

const MAX_FILE_SIZE_FREE = 20 * 1024 * 1024; // 20MB per file (free)
const MAX_FILE_SIZE_PAID = 5 * 1024 * 1024 * 1024; // 5GB per file (Drive API limit)

function sanitizeDrivePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\.\.\//g, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function guessUploadMimeType(fileName: string, requestedMimeType: string | null | undefined): string {
  if (requestedMimeType && requestedMimeType !== "application/octet-stream") return requestedMimeType;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".base")) return "text/yaml";
  if (lower.endsWith(".kanban")) return "text/yaml";
  if (lower.endsWith(".dashboard")) return "text/yaml";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "text/yaml";
  return requestedMimeType || "application/octet-stream";
}

async function getMaxFileSize(rootFolderId: string, email?: string | null): Promise<number> {
  try {
    const { getAccountByRootFolderIdOrEmail } = await import("~/services/hubwork-accounts.server");
    const account = await getAccountByRootFolderIdOrEmail(rootFolderId, email);
    if (account?.plan) return MAX_FILE_SIZE_PAID;
  } catch {
    // Treat lookup failures as free tier.
  }
  return MAX_FILE_SIZE_FREE;
}

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  if (request.headers.get("Content-Type")?.toLowerCase().includes("multipart/form-data")) {
    const formData = await request.formData();
    const intent = formData.get("intent");
    if (intent !== "upload-file") {
      return Response.json({ error: "Invalid request" }, { status: 400, headers: responseHeaders });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400, headers: responseHeaders });
    }

    const targetFolderId = (formData.get("folderId") as string | null) || validTokens.rootFolderId;
    const clientPath = (formData.get("clientPath") as string | null) || file.name;
    const safeName = sanitizeDrivePath(clientPath);
    if (!safeName) {
      return Response.json({ error: "Invalid file path" }, { status: 400, headers: responseHeaders });
    }

    const size = Number(formData.get("size") ?? file.size);
    const maxFileSize = await getMaxFileSize(validTokens.rootFolderId, validTokens.email);
    if (!Number.isFinite(size) || size < 0 || size > maxFileSize) {
      const limitMB = Math.round(maxFileSize / 1024 / 1024);
      return Response.json(
        { error: `File too large (${(size / 1024 / 1024).toFixed(1)}MB). Max ${limitMB}MB per file.` },
        { status: 413, headers: responseHeaders }
      );
    }

    const replaceFileId = formData.get("replaceFileId") as string | null;
    const safePrefix = sanitizeDrivePath((formData.get("namePrefix") as string | null) || "");
    const uploadName = safePrefix ? `${safePrefix}/${safeName}` : safeName;
    const mimeType = guessUploadMimeType(uploadName, (formData.get("mimeType") as string | null) || file.type);
    let uploadUrl: string;

    if (replaceFileId) {
      const fileMeta = await getFileMetadata(validTokens.accessToken, replaceFileId);
      if (!fileMeta.parents?.includes(targetFolderId)) {
        return Response.json(
          { error: "File does not belong to target folder" },
          { status: 400, headers: responseHeaders }
        );
      }
      uploadUrl = await updateResumableUploadSession(
        validTokens.accessToken,
        replaceFileId,
        mimeType,
        size
      );
    } else {
      uploadUrl = await createResumableUploadSession(
        validTokens.accessToken,
        uploadName,
        targetFolderId,
        mimeType,
        size
      );
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const uploaded = await uploadResumableFile(uploadUrl, buffer, mimeType);
      const uploadedFile = await getFileMetadata(validTokens.accessToken, uploaded.id);
      if (!uploadedFile.parents?.includes(targetFolderId)) {
        return Response.json(
          { error: "Uploaded file does not belong to target folder" },
          { status: 400, headers: responseHeaders }
        );
      }

      await upsertFileInMeta(validTokens.accessToken, targetFolderId, uploadedFile);
      return Response.json({ file: uploadedFile }, { headers: responseHeaders });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Upload failed" },
        { status: 502, headers: responseHeaders }
      );
    }
  }

  const body = await request.json().catch(() => null) as
    | {
        intent?: "create-session" | "complete";
        folderId?: string;
        namePrefix?: string;
        clientPath?: string;
        fileName?: string;
        mimeType?: string;
        size?: number;
        replaceFileId?: string;
        fileId?: string;
      }
    | null;

  if (!body?.intent) {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: responseHeaders });
  }

  const targetFolderId = body.folderId || validTokens.rootFolderId;

  if (body.intent === "create-session") {
    const clientPath = body.clientPath || body.fileName || "";
    const safeName = sanitizeDrivePath(clientPath);
    if (!safeName) {
      return Response.json({ error: "Invalid file path" }, { status: 400, headers: responseHeaders });
    }

    const size = Number(body.size ?? 0);
    const maxFileSize = await getMaxFileSize(validTokens.rootFolderId);
    if (!Number.isFinite(size) || size < 0 || size > maxFileSize) {
      const limitMB = Math.round(maxFileSize / 1024 / 1024);
      return Response.json(
        { error: `File too large (${(size / 1024 / 1024).toFixed(1)}MB). Max ${limitMB}MB per file.` },
        { status: 413, headers: responseHeaders }
      );
    }

    const safePrefix = sanitizeDrivePath(body.namePrefix || "");
    const uploadName = safePrefix ? `${safePrefix}/${safeName}` : safeName;
    const mimeType = guessUploadMimeType(uploadName, body.mimeType);
    let uploadUrl: string;

    if (body.replaceFileId) {
      const fileMeta = await getFileMetadata(validTokens.accessToken, body.replaceFileId);
      if (!fileMeta.parents?.includes(targetFolderId)) {
        return Response.json(
          { error: "File does not belong to target folder" },
          { status: 400, headers: responseHeaders }
        );
      }
      uploadUrl = await updateResumableUploadSession(
        validTokens.accessToken,
        body.replaceFileId,
        mimeType,
        size
      );
    } else {
      uploadUrl = await createResumableUploadSession(
        validTokens.accessToken,
        uploadName,
        targetFolderId,
        mimeType,
        size
      );
    }

    return Response.json({ uploadUrl, name: safeName }, { headers: responseHeaders });
  }

  const fileId = body.fileId;
  if (!fileId) {
    return Response.json({ error: "Missing fileId" }, { status: 400, headers: responseHeaders });
  }

  const file = await getFileMetadata(validTokens.accessToken, fileId);
  if (!file.parents?.includes(targetFolderId)) {
    return Response.json(
      { error: "Uploaded file does not belong to target folder" },
      { status: 400, headers: responseHeaders }
    );
  }

  await upsertFileInMeta(validTokens.accessToken, targetFolderId, file);
  return Response.json({ file }, { headers: responseHeaders });
}
