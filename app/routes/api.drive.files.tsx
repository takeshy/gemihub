import type { Route } from "./+types/api.drive.files";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  readFile,
  readFileRaw,
  deleteFile,
  createFile,
  createFileBinary,
  createGoogleDocFromHtml,
  exportFile,
  updateFile,
  updateFileBinary,
  moveFile,
  renameFile,
  searchFiles,
  listFiles,
  getFileMetadata,
  publishFile,
  unpublishFile,
  ensureSubFolder,
} from "~/services/google-drive.server";
import { renderHtmlToPrintableHtml, renderMarkdownToPrintableHtml } from "~/services/markdown-pdf.server";
import { getSettings } from "~/services/user-settings.server";
import {
  encryptFileContent,
} from "~/services/crypto.server";
import {
  getFileListFromMeta,
  upsertFileInMeta,
  removeFileFromMeta,
  setFileSharedInMeta,
  readRemoteSyncMeta,
} from "~/services/sync-meta.server";
import { saveSettings } from "~/services/user-settings.server";
import { deleteSingleFileFromRag } from "~/services/file-search.server";
import { DEFAULT_RAG_STORE_KEY } from "~/types/settings";
import { saveEdit } from "~/services/edit-history.server";

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
  const folderId = url.searchParams.get("folderId");

  switch (action) {
    case "list": {
      if (folderId) {
        const files = await listFiles(validTokens.accessToken, folderId);
        return jsonWithCookie({ files });
      }
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
  const { action: actionType, fileId, name, content, data, mimeType, overwriteFileId } = body;

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
    case "create-image": {
      if (!name || !data) return jsonWithCookie({ error: "Missing name or data" }, { status: 400 });
      const buf = Buffer.from(data, "base64");
      const file = await createFileBinary(
        validTokens.accessToken,
        name,
        buf,
        validTokens.rootFolderId,
        mimeType || "image/png"
      );
      const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, file);
      return jsonWithCookie({ file, meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files } });
    }
    case "create-markdown-pdf": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });

      const sourceMeta = await getFileMetadata(validTokens.accessToken, fileId);
      const lowerName = sourceMeta.name.toLowerCase();
      const isMarkdown = lowerName.endsWith(".md") || sourceMeta.mimeType === "text/markdown";
      const isHtml = lowerName.endsWith(".html") || lowerName.endsWith(".htm") || sourceMeta.mimeType === "text/html";
      if (!isMarkdown && !isHtml) {
        return jsonWithCookie({ error: "Only markdown/html files are supported" }, { status: 400 });
      }

      // Use client-provided content (local cache) if available, otherwise read from Drive
      const sourceContent = content ?? await readFile(validTokens.accessToken, fileId);
      const sourceBaseName = sourceMeta.name.split("/").pop() ?? sourceMeta.name;
      const sourceStem = sourceBaseName.replace(/\.(md|html?)$/i, "");
      const pdfName = `temporaries/${sourceStem}.pdf`;

      const html = isMarkdown
        ? renderMarkdownToPrintableHtml(sourceContent, sourceStem || sourceBaseName)
        : renderHtmlToPrintableHtml(sourceContent, sourceStem || sourceBaseName);
      const tmpFolderId = await ensureSubFolder(validTokens.accessToken, validTokens.rootFolderId, "tmp");
      const tempGoogleDoc = await createGoogleDocFromHtml(
        validTokens.accessToken,
        `${sourceStem || "document"}.gdoc.tmp`,
        html,
        tmpFolderId
      );

      try {
        const pdfBuffer = await exportFile(validTokens.accessToken, tempGoogleDoc.id, "application/pdf");
        const file = overwriteFileId
          ? await updateFileBinary(
            validTokens.accessToken,
            overwriteFileId,
            pdfBuffer,
            "application/pdf"
          )
          : await createFileBinary(
            validTokens.accessToken,
            pdfName,
            pdfBuffer,
            validTokens.rootFolderId,
            "application/pdf"
          );
        const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, file);
        return jsonWithCookie({ file, meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files } });
      } finally {
        try {
          await deleteFile(validTokens.accessToken, tempGoogleDoc.id);
        } catch {
          // best-effort cleanup of temporary Google Doc
        }
      }
    }
    case "update": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });

      // Read old content for remote edit history (before update)
      let oldContent: string | null = null;
      try {
        oldContent = await readFile(validTokens.accessToken, fileId);
      } catch {
        // File might be new or unreadable, skip history
      }

      const file = await updateFile(validTokens.accessToken, fileId, content, mimeType || "text/plain");
      const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, file);

      // Save remote edit history (best-effort)
      if (oldContent != null && content != null && oldContent !== content) {
        try {
          const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
          await saveEdit(validTokens.accessToken, validTokens.rootFolderId, settings.editHistory, {
            path: file.name,
            oldContent,
            newContent: content,
            source: "manual",
          });
        } catch {
          // Best-effort: don't block file update
        }
      }

      return jsonWithCookie({
        file,
        md5Checksum: file.md5Checksum,
        meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files },
      });
    }
    case "rename": {
      if (!fileId || !name) return jsonWithCookie({ error: "Missing fileId or name" }, { status: 400 });

      // Re-key RAG tracking if file was renamed (best-effort)
      try {
        const syncMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        const oldName = syncMeta?.files[fileId]?.name;
        if (oldName && oldName !== name) {
          const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
          const ragSetting = settings.ragSettings[DEFAULT_RAG_STORE_KEY];
          if (ragSetting?.files?.[oldName]) {
            ragSetting.files[name] = ragSetting.files[oldName];
            delete ragSetting.files[oldName];
            await saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
          }
        }
      } catch {
        // Best-effort: don't block rename
      }

      const renamed = await renameFile(validTokens.accessToken, fileId, name);
      const updatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, renamed);
      return jsonWithCookie({ file: renamed, meta: { lastUpdatedAt: updatedMeta.lastUpdatedAt, files: updatedMeta.files } });
    }
    case "delete": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });

      // Clean up RAG tracking (best-effort)
      try {
        const syncMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        const fileName = syncMeta?.files[fileId]?.name;
        if (fileName) {
          const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
          const ragSetting = settings.ragSettings[DEFAULT_RAG_STORE_KEY];
          const ragFile = ragSetting?.files?.[fileName];
          if (ragFile) {
            let canRemoveTracking = !ragFile.fileId;
            if (ragFile.fileId && validTokens.geminiApiKey) {
              canRemoveTracking = await deleteSingleFileFromRag(validTokens.geminiApiKey, ragFile.fileId);
            }
            if (canRemoveTracking) {
              delete ragSetting.files[fileName];
              await saveSettings(validTokens.accessToken, validTokens.rootFolderId, settings);
            }
          }
        }
      } catch {
        // Best-effort: don't block delete
      }

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
      // Clean up RAG tracking for old filename before encrypting (best-effort)
      try {
        const syncMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        const oldName = syncMeta?.files[fileId]?.name;
        if (oldName) {
          const ragSetting = encSettings.ragSettings[DEFAULT_RAG_STORE_KEY];
          const ragFile = ragSetting?.files?.[oldName];
          if (ragFile) {
            let canRemoveTracking = !ragFile.fileId;
            if (ragFile.fileId && validTokens.geminiApiKey) {
              canRemoveTracking = await deleteSingleFileFromRag(validTokens.geminiApiKey, ragFile.fileId);
            }
            if (canRemoveTracking) {
              delete ragSetting.files[oldName];
              await saveSettings(validTokens.accessToken, validTokens.rootFolderId, encSettings);
            }
          }
        }
      } catch {
        // Best-effort: don't block encrypt
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
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      if (!content) return jsonWithCookie({ error: "Missing content" }, { status: 400 });
      // Check for duplicate name before proceeding
      const decCurrentMeta = await getFileMetadata(validTokens.accessToken, fileId);
      if (decCurrentMeta.name.endsWith(".encrypted")) {
        const targetName = decCurrentMeta.name.slice(0, -".encrypted".length);
        const syncMeta = await readRemoteSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        if (syncMeta) {
          const duplicate = Object.entries(syncMeta.files).find(
            ([id, f]) => id !== fileId && f.name === targetName
          );
          if (duplicate) {
            return jsonWithCookie({ error: "duplicate", name: targetName }, { status: 409 });
          }
        }
      }
      // Update file content with decrypted plaintext
      const decFile = await updateFile(validTokens.accessToken, fileId, content);
      // Remove .encrypted extension from filename
      let decRenamed = decFile;
      if (decFile.name.endsWith(".encrypted")) {
        const newName = decFile.name.slice(0, -".encrypted".length);
        decRenamed = await renameFile(validTokens.accessToken, fileId, newName);
      }
      const decUpdatedMeta = await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, decRenamed);
      return jsonWithCookie({ file: decRenamed, meta: { lastUpdatedAt: decUpdatedMeta.lastUpdatedAt, files: decUpdatedMeta.files } });
    }
    case "publish": {
      if (!fileId) return jsonWithCookie({ error: "Missing fileId" }, { status: 400 });
      const webViewLink = await publishFile(validTokens.accessToken, fileId);

      // For markdown/HTML files, find internal image URLs, publish those images,
      // and replace links with public URLs
      const fileMeta = await getFileMetadata(validTokens.accessToken, fileId);
      const ext = fileMeta.name.split(".").pop()?.toLowerCase();
      if (ext === "md" || ext === "html" || ext === "htm") {
        const fileContent = await readFile(validTokens.accessToken, fileId);
        const internalUrlPattern = /\/api\/drive\/files\?action=raw&fileId=([a-zA-Z0-9_-]+)/g;
        const imageFileIds = new Set<string>();
        let urlMatch;
        while ((urlMatch = internalUrlPattern.exec(fileContent)) !== null) {
          imageFileIds.add(urlMatch[1]);
        }

        if (imageFileIds.size > 0) {
          const replacements = new Map<string, string>();
          for (const imgFileId of imageFileIds) {
            await publishFile(validTokens.accessToken, imgFileId);
            const imgMeta = await getFileMetadata(validTokens.accessToken, imgFileId);
            await setFileSharedInMeta(validTokens.accessToken, validTokens.rootFolderId, imgFileId, true);
            replacements.set(
              `/api/drive/files?action=raw&fileId=${imgFileId}`,
              `/public/file/${imgFileId}/${encodeURIComponent(imgMeta.name)}`
            );
          }

          let updatedContent = fileContent;
          for (const [oldUrl, newUrl] of replacements) {
            updatedContent = updatedContent.replaceAll(oldUrl, newUrl);
          }

          const updatedFile = await updateFile(validTokens.accessToken, fileId, updatedContent, fileMeta.mimeType);
          await upsertFileInMeta(validTokens.accessToken, validTokens.rootFolderId, updatedFile);
        }
      }

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
