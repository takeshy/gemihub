import type { Route } from "./+types/api.drive.files";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  listFiles,
  readFile,
  readFileRaw,
  createFile,
  createFolder,
  updateFile,
  deleteFile,
  renameFile,
  moveFile,
  searchFiles,
  getFileMetadata,
  getWorkflowsFolderId,
} from "~/services/google-drive.server";
import { getSettings } from "~/services/user-settings.server";
import { saveEdit } from "~/services/edit-history.server";
import {
  encryptFileContent,
  decryptFileContent,
} from "~/services/crypto.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, tokens);

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const fileId = url.searchParams.get("fileId");
  const query = url.searchParams.get("query");

  const workflowsFolderId = await getWorkflowsFolderId(
    validTokens.accessToken,
    validTokens.rootFolderId
  );

  switch (action) {
    case "list": {
      const files = await listFiles(validTokens.accessToken, workflowsFolderId);
      return Response.json({ files });
    }
    case "metadata": {
      if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
      const meta = await getFileMetadata(validTokens.accessToken, fileId);
      return Response.json({ md5Checksum: meta.md5Checksum, modifiedTime: meta.modifiedTime });
    }
    case "read": {
      if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
      const [content, meta] = await Promise.all([
        readFile(validTokens.accessToken, fileId),
        getFileMetadata(validTokens.accessToken, fileId),
      ]);
      return Response.json({ content, md5Checksum: meta.md5Checksum, modifiedTime: meta.modifiedTime });
    }
    case "search": {
      if (!query) return Response.json({ error: "Missing query" }, { status: 400 });
      const files = await searchFiles(validTokens.accessToken, workflowsFolderId, query);
      return Response.json({ files });
    }
    case "raw": {
      if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
      const meta = await getFileMetadata(validTokens.accessToken, fileId);
      const rawRes = await readFileRaw(validTokens.accessToken, fileId);
      return new Response(rawRes.body, {
        headers: {
          "Content-Type": meta.mimeType || "application/octet-stream",
          "Content-Disposition": `inline; filename="${encodeURIComponent(meta.name)}"`,
        },
      });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, tokens);

  const body = await request.json();
  const { action: actionType, fileId, name, content, password, folderId, mimeType, newParentId, oldParentId } = body;

  const workflowsFolderId = await getWorkflowsFolderId(
    validTokens.accessToken,
    validTokens.rootFolderId
  );

  switch (actionType) {
    case "create": {
      const parentId = folderId || workflowsFolderId;
      const file = await createFile(
        validTokens.accessToken,
        name,
        content || "",
        parentId,
        mimeType || "text/yaml"
      );
      return Response.json({ file });
    }
    case "createFolder": {
      if (!name) return Response.json({ error: "Missing name" }, { status: 400 });
      const parentId = folderId || validTokens.rootFolderId;
      const folder = await createFolder(
        validTokens.accessToken,
        name,
        parentId
      );
      return Response.json({ file: folder });
    }
    case "update": {
      if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
      const file = await updateFile(validTokens.accessToken, fileId, content, "text/yaml");

      // Save edit history
      let editHistoryEntry = null;
      try {
        const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
        const meta = await getFileMetadata(validTokens.accessToken, fileId);
        editHistoryEntry = await saveEdit(
          validTokens.accessToken,
          validTokens.rootFolderId,
          settings.editHistory,
          {
            path: meta.name,
            modifiedContent: content,
            source: "manual",
          }
        );
      } catch {
        // Don't fail the update if edit history fails
      }

      return Response.json({
        file,
        md5Checksum: file.md5Checksum,
        editHistoryEntry,
      });
    }
    case "move": {
      if (!fileId || !newParentId || !oldParentId) {
        return Response.json({ error: "Missing fileId, newParentId, or oldParentId" }, { status: 400 });
      }
      const movedFile = await moveFile(validTokens.accessToken, fileId, newParentId, oldParentId);
      return Response.json({ file: movedFile });
    }
    case "rename": {
      if (!fileId || !name) return Response.json({ error: "Missing fileId or name" }, { status: 400 });
      const renamed = await renameFile(validTokens.accessToken, fileId, name);
      return Response.json({ file: renamed });
    }
    case "delete": {
      if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
      await deleteFile(validTokens.accessToken, fileId);
      return Response.json({ ok: true });
    }
    case "encrypt": {
      if (!fileId) {
        return Response.json({ error: "Missing fileId" }, { status: 400 });
      }
      const encSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      if (!encSettings.encryption.enabled || !encSettings.encryption.publicKey) {
        return Response.json({ error: "Encryption not configured" }, { status: 400 });
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
      return Response.json({ file: renamedFile });
    }
    case "decrypt": {
      if (!fileId || !password) {
        return Response.json({ error: "Missing fileId or password" }, { status: 400 });
      }
      const encryptedContent = await readFile(validTokens.accessToken, fileId);
      let decrypted: string;
      try {
        decrypted = await decryptFileContent(encryptedContent, password);
      } catch {
        return Response.json({ error: "Invalid password" }, { status: 401 });
      }
      await updateFile(validTokens.accessToken, fileId, decrypted);
      const decMeta = await getFileMetadata(validTokens.accessToken, fileId);
      const newName = decMeta.name.replace(/\.encrypted$/, "");
      const decRenamedFile = await renameFile(validTokens.accessToken, fileId, newName);
      return Response.json({ file: decRenamedFile });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
