import type { Route } from "./+types/api.drive.files";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  readFile,
  readFileRaw,
  createFile,
  updateFile,
  moveFile,
  renameFile,
  searchFiles,
  getFileMetadata,
  publishFile,
  unpublishFile,
  ensureSubFolder,
} from "~/services/google-drive.server";
import { getSettings } from "~/services/user-settings.server";
import {
  encryptFileContent,
  decryptFileContent,
} from "~/services/crypto.server";
import {
  getFileListFromMeta,
  upsertFileInMeta,
  removeFileFromMeta,
  setFileSharedInMeta,
} from "~/services/sync-meta.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const fileId = url.searchParams.get("fileId");
  const query = url.searchParams.get("query");

  switch (action) {
    case "list": {
      const { files, meta } = await getFileListFromMeta(validTokens.accessToken, validTokens.rootFolderId);
      return jsonWithCookie({ files, meta: { lastUpdatedAt: meta.lastUpdatedAt, files: meta.files } });
    }
    case "metadata": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      const meta = await getFileMetadata(validTokens.accessToken, fileId);
      return jsonWithCookie({ name: meta.name, mimeType: meta.mimeType, md5Checksum: meta.md5Checksum, modifiedTime: meta.modifiedTime });
    }
    case "read": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      const [content, meta] = await Promise.all([
        readFile(validTokens.accessToken, fileId),
        getFileMetadata(validTokens.accessToken, fileId),
      ]);
      return jsonWithCookie({ content, md5Checksum: meta.md5Checksum, modifiedTime: meta.modifiedTime });
    }
    case "search": {
      if (!query) return jsonWithCookie({ error: "Missing query" }, { status: 400 });
      const files = await searchFiles(validTokens.accessToken, validTokens.rootFolderId, query);
      return jsonWithCookie({ files });
    }
    case "raw": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      const meta = await getFileMetadata(validTokens.accessToken, fileId);
      const rawRes = await readFileRaw(validTokens.accessToken, fileId);
      const headers = new Headers({
        "Content-Type": meta.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(meta.name)}"`,
      });
      if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
      return new Response(rawRes.body, { headers });
    }
    default:
      return jsonWithCookie({ error: "Unknown action" }, { status: 400 });
  }
}

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const jsonWithCookie = (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    return Response.json(data, { ...init, headers });
  };

  const body = await request.json();
  const { action: actionType, fileId, name, content, password, mimeType } = body;

  switch (actionType) {
    case "create": {
      const file = await createFile(
        validTokens.accessToken,
        name,
        content || "",
        validTokens.rootFolderId,
        mimeType || "text/yaml"
      );
      const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, file);
      return jsonWithCookie({ file, meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files } });
    }
    case "update": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      const file = await updateFile(validTokens.accessToken, fileId, content, mimeType || "text/plain");

      const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, file);
      return jsonWithCookie({
        file,
        md5Checksum: file.md5Checksum,
        meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files },
      });
    }
    case "rename": {
      if (!fileId || !name) return jsonWithCookie({ error: "Missing fileId or name" }, { status: 400 });
      const renamed = await renameFile(validTokens.accessToken, fileId, name);
      const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, renamed);
      return jsonWithCookie({ file: renamed, meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files } });
    }
    case "delete": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      // Soft delete: move to trash/ subfolder instead of permanent deletion
      const trashFolderId = await ensureSubFolder(validTokens.accessToken, validTokens.rootFolderId, "trash");
      await moveFile(validTokens.accessToken, fileId, trashFolderId, validTokens.rootFolderId);
      const updatedMeta = await removeFileFromMeta(validTokens.accessToken, validTokens.rootFolderId, fileId);
      return jsonWithCookie({ ok: true, meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files } });
    }
    case "encrypt": {
      if (!fileId) {
        return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      }
      const encSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      if (!encSettings.encryption.enabled || !encSettings.encryption.publicKey) {
        return jsonWithCookie({ error: "Encryption not configured" }, { status: 400 });
      }
      const plainContent = await readFile(validTokens.accessToken, fileId);
      const encrypted = await encryptFileContent(
        plainContent,
        encSettings.encryption.publicKey,
        encSettings.encryption.encryptedPrivateKey,
        encSettings.encryption.salt
      );
      await updateFile(validTokens.accessToken, fileId, encrypted);
      const meta = await getFileMetadata(validTokens.accessToken, fileId);
      const renamedFile = await renameFile(
        validTokens.accessToken,
        fileId,
        meta.name + ".encrypted"
      );
      const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, renamedFile);
      return jsonWithCookie({ file: renamedFile, meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files } });
    }
    case "decrypt": {
      if (!fileId || !password) {
        return jsonWithCookie({ error: "Missing fileId or password" }, { status: 400 });
      }
      const encryptedContent = await readFile(validTokens.accessToken, fileId);
      let decrypted: string;
      try {
        decrypted = await decryptFileContent(encryptedContent, password);
      } catch {
        return jsonWithCookie({ error: "Invalid password" }, { status: 401 });
      }
      await updateFile(validTokens.accessToken, fileId, decrypted);
      const decMeta = await getFileMetadata(validTokens.accessToken, fileId);
      const newName = decMeta.name.replace(/\.encrypted$/, "");
      const decRenamedFile = await renameFile(validTokens.accessToken, fileId, newName);
      const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, decRenamedFile);
      return jsonWithCookie({ file: decRenamedFile, meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files } });
    }
    case "publish": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      const webViewLink = await publishFile(validTokens.accessToken, fileId);
      const pubMeta = await setFileSharedInMeta(validTokens.accessToken, validTokens.rootFolderId, fileId, true, webViewLink);
      return jsonWithCookie({ webViewLink, meta: { lastUpdatedAt: pubMeta.lastUpdatedAt, files: pubMeta.files } });
    }
    case "unpublish": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      await unpublishFile(validTokens.accessToken, fileId);
      const unpubMeta = await setFileSharedInMeta(validTokens.accessToken, validTokens.rootFolderId, fileId, false);
      return jsonWithCookie({ ok: true, meta: { lastUpdatedAt: unpubMeta.lastUpdatedAt, files: unpubMeta.files } });
    }
    default:
      return jsonWithCookie({ error: "Unknown action" }, { status: 400 });
  }
}
