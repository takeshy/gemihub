import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";
import { isBinaryMimeType, resolveExistingFile } from "./driveUtils";
import * as driveService from "~/services/google-drive.server";
import { encryptFileContent } from "~/services/crypto.server";
import { renderMarkdownToPrintableHtml, renderHtmlToPrintableHtml } from "~/services/markdown-pdf.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { upsertFileInMeta, setFileSharedInMeta, readRemoteSyncMeta } from "~/services/sync-meta.server";
import { deleteSingleFileFromRag } from "~/services/file-search.server";
import { DEFAULT_RAG_STORE_KEY } from "~/types/settings";

export async function handleGemihubCommandNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
): Promise<string> {
  const command = replaceVariables(node.properties["command"] || "", context);
  const pathRaw = node.properties["path"] || "";
  const text = replaceVariables(node.properties["text"] || "", context);
  const saveTo = node.properties["saveTo"];

  if (!command) throw new Error("gemihub-command node missing 'command' property");
  if (!pathRaw.trim()) throw new Error("gemihub-command node missing 'path' property");

  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;
  let result = "";

  switch (command) {
    case "encrypt": {
      const file = await resolveExistingFile(pathRaw, context, serviceContext);
      const settings = await getSettings(accessToken, folderId);
      if (!settings.encryption.enabled || !settings.encryption.publicKey) {
        throw new Error("Encryption not configured");
      }

      // Clean up RAG tracking (best-effort)
      try {
        const ragSetting = settings.ragSettings[DEFAULT_RAG_STORE_KEY];
        const ragFile = ragSetting?.files?.[file.name];
        if (ragFile) {
          let canRemove = !ragFile.fileId;
          if (ragFile.fileId && serviceContext.geminiApiKey) {
            canRemove = await deleteSingleFileFromRag(serviceContext.geminiApiKey, ragFile.fileId);
          }
          if (canRemove) {
            delete ragSetting.files[file.name];
            await saveSettings(accessToken, folderId, settings);
          }
        }
      } catch { /* best-effort */ }

      const plainContent = await driveService.readFile(accessToken, file.id, {
        signal: serviceContext.abortSignal,
      });
      const encrypted = await encryptFileContent(
        plainContent,
        settings.encryption.publicKey,
        settings.encryption.encryptedPrivateKey,
        settings.encryption.salt,
      );
      await driveService.updateFile(accessToken, file.id, encrypted, undefined, { signal: serviceContext.abortSignal });
      const renamedFile = await driveService.renameFile(accessToken, file.id, file.name + ".encrypted", { signal: serviceContext.abortSignal });
      await upsertFileInMeta(accessToken, folderId, renamedFile, { signal: serviceContext.abortSignal });
      serviceContext.onDriveFileUpdated?.({
        fileId: file.id,
        fileName: renamedFile.name,
        content: encrypted,
      });
      result = renamedFile.name;
      break;
    }

    case "publish": {
      const file = await resolveExistingFile(pathRaw, context, serviceContext);
      const webViewLink = await driveService.publishFile(accessToken, file.id, { signal: serviceContext.abortSignal });

      // For markdown/HTML files, publish internal images and rewrite URLs
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "md" || ext === "html" || ext === "htm") {
        const fileContent = await driveService.readFile(accessToken, file.id, {
          signal: serviceContext.abortSignal,
        });
        const internalUrlPattern = /\/api\/drive\/files\?action=raw&fileId=([a-zA-Z0-9_-]+)/g;
        const imageFileIds = new Set<string>();
        let urlMatch;
        while ((urlMatch = internalUrlPattern.exec(fileContent)) !== null) {
          imageFileIds.add(urlMatch[1]);
        }

        if (imageFileIds.size > 0) {
          const replacements = new Map<string, string>();
          for (const imgFileId of imageFileIds) {
            await driveService.publishFile(accessToken, imgFileId, { signal: serviceContext.abortSignal });
            const imgMeta = await driveService.getFileMetadata(accessToken, imgFileId, {
              signal: serviceContext.abortSignal,
            });
            await setFileSharedInMeta(accessToken, folderId, imgFileId, true);
            replacements.set(
              `/api/drive/files?action=raw&fileId=${imgFileId}`,
              `/public/file/${imgFileId}/${encodeURIComponent(imgMeta.name)}`,
            );
          }
          let updatedContent = fileContent;
          for (const [oldUrl, newUrl] of replacements) {
            updatedContent = updatedContent.replaceAll(oldUrl, newUrl);
          }
          const updatedFile = await driveService.updateFile(accessToken, file.id, updatedContent, file.mimeType, { signal: serviceContext.abortSignal });
          await upsertFileInMeta(accessToken, folderId, updatedFile, { signal: serviceContext.abortSignal });
          serviceContext.onDriveFileUpdated?.({
            fileId: file.id,
            fileName: file.name,
            content: updatedContent,
          });
        }
      }

      await setFileSharedInMeta(accessToken, folderId, file.id, true, webViewLink);
      result = webViewLink;
      break;
    }

    case "unpublish": {
      const file = await resolveExistingFile(pathRaw, context, serviceContext);
      await driveService.unpublishFile(accessToken, file.id, { signal: serviceContext.abortSignal });
      await setFileSharedInMeta(accessToken, folderId, file.id, false);
      result = "ok";
      break;
    }

    case "duplicate": {
      const file = await resolveExistingFile(pathRaw, context, serviceContext);
      const baseName = file.name.includes("/") ? file.name.split("/").pop()! : file.name;
      const fileExt = baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".")) : "";
      const stem = baseName.includes(".") ? baseName.slice(0, baseName.lastIndexOf(".")) : baseName;
      const prefix = file.name.includes("/") ? file.name.slice(0, file.name.lastIndexOf("/") + 1) : "";
      const newName = text || `${prefix}${stem} (copy)${fileExt}`;

      let newFile: driveService.DriveFile;
      if (isBinaryMimeType(file.mimeType)) {
        const rawRes = await driveService.readFileRaw(accessToken, file.id, {
          signal: serviceContext.abortSignal,
        });
        const buffer = Buffer.from(await rawRes.arrayBuffer());
        newFile = await driveService.createFileBinary(accessToken, newName, buffer, folderId, file.mimeType, {
          signal: serviceContext.abortSignal,
        });
      } else {
        const content = await driveService.readFile(accessToken, file.id, {
          signal: serviceContext.abortSignal,
        });
        newFile = await driveService.createFile(accessToken, newName, content, folderId, file.mimeType, {
          signal: serviceContext.abortSignal,
        });
      }
      await upsertFileInMeta(accessToken, folderId, newFile, { signal: serviceContext.abortSignal });
      serviceContext.onDriveFileCreated?.({
        fileId: newFile.id,
        fileName: newFile.name,
        content: "",
        md5Checksum: newFile.md5Checksum || "",
        modifiedTime: newFile.modifiedTime || "",
      });
      result = newFile.name;
      break;
    }

    case "convert-to-pdf": {
      const file = await resolveExistingFile(pathRaw, context, serviceContext);
      const lowerName = file.name.toLowerCase();
      const isMarkdown = lowerName.endsWith(".md") || file.mimeType === "text/markdown";
      const isHtml = lowerName.endsWith(".html") || lowerName.endsWith(".htm") || file.mimeType === "text/html";
      if (!isMarkdown && !isHtml) {
        throw new Error("Only markdown/html files are supported for PDF conversion");
      }

      const sourceContent = await driveService.readFile(accessToken, file.id, {
        signal: serviceContext.abortSignal,
      });
      const sourceBaseName = file.name.split("/").pop() ?? file.name;
      const sourceStem = sourceBaseName.replace(/\.(md|html?)$/i, "");
      const pdfName = `temporaries/${sourceStem}.pdf`;

      const html = isMarkdown
        ? renderMarkdownToPrintableHtml(sourceContent, sourceStem || sourceBaseName)
        : renderHtmlToPrintableHtml(sourceContent, sourceStem || sourceBaseName);
      const tmpFolderId = await driveService.ensureSubFolder(accessToken, folderId, "tmp", {
        signal: serviceContext.abortSignal,
      });
      const tempGoogleDoc = await driveService.createGoogleDocFromHtml(
        accessToken,
        `${sourceStem || "document"}.gdoc.tmp`,
        html,
        tmpFolderId,
        { signal: serviceContext.abortSignal },
      );

      try {
        const pdfBuffer = await driveService.exportFile(accessToken, tempGoogleDoc.id, "application/pdf", { signal: serviceContext.abortSignal });
        const pdfFile = await driveService.createFileBinary(
          accessToken,
          pdfName,
          pdfBuffer,
          folderId,
          "application/pdf",
          { signal: serviceContext.abortSignal },
        );
        await upsertFileInMeta(accessToken, folderId, pdfFile, { signal: serviceContext.abortSignal });
        serviceContext.onDriveFileCreated?.({
          fileId: pdfFile.id,
          fileName: pdfFile.name,
          content: "",
          md5Checksum: pdfFile.md5Checksum || "",
          modifiedTime: pdfFile.modifiedTime || "",
        });
        result = pdfFile.name;
      } finally {
        try {
          await driveService.deleteFile(accessToken, tempGoogleDoc.id);
        } catch { /* best-effort cleanup */ }
      }
      break;
    }

    case "convert-to-html": {
      const file = await resolveExistingFile(pathRaw, context, serviceContext);
      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith(".md") && file.mimeType !== "text/markdown") {
        throw new Error("Only markdown files are supported for HTML conversion");
      }

      const sourceContent = await driveService.readFile(accessToken, file.id, {
        signal: serviceContext.abortSignal,
      });
      const sourceBaseName = file.name.split("/").pop() ?? file.name;
      const sourceStem = sourceBaseName.replace(/\.md$/i, "");
      const htmlName = `temporaries/${sourceStem}.html`;

      const html = renderMarkdownToPrintableHtml(sourceContent, sourceStem || sourceBaseName);
      const htmlFile = await driveService.createFile(
        accessToken,
        htmlName,
        html,
        folderId,
        "text/html",
        { signal: serviceContext.abortSignal },
      );
      await upsertFileInMeta(accessToken, folderId, htmlFile, { signal: serviceContext.abortSignal });
      serviceContext.onDriveFileCreated?.({
        fileId: htmlFile.id,
        fileName: htmlFile.name,
        content: html,
        md5Checksum: htmlFile.md5Checksum || "",
        modifiedTime: htmlFile.modifiedTime || "",
      });
      result = htmlFile.name;
      break;
    }

    case "rename": {
      if (!text) throw new Error("gemihub-command 'rename' requires 'text' property (new name)");
      const file = await resolveExistingFile(pathRaw, context, serviceContext);

      // Re-key RAG tracking (best-effort)
      try {
        const syncMeta = await readRemoteSyncMeta(accessToken, folderId);
        const oldName = syncMeta?.files[file.id]?.name;
        if (oldName && oldName !== text) {
          const settings = await getSettings(accessToken, folderId);
          const ragSetting = settings.ragSettings[DEFAULT_RAG_STORE_KEY];
          if (ragSetting?.files?.[oldName]) {
            ragSetting.files[text] = ragSetting.files[oldName];
            delete ragSetting.files[oldName];
            await saveSettings(accessToken, folderId, settings);
          }
        }
      } catch { /* best-effort */ }

      const renamed = await driveService.renameFile(accessToken, file.id, text, { signal: serviceContext.abortSignal });
      await upsertFileInMeta(accessToken, folderId, renamed, { signal: serviceContext.abortSignal });
      // Content omitted: rename doesn't change file content, only the name.
      // drive-file-sse will dispatch sync-complete to rebuild the tree.
      serviceContext.onDriveFileUpdated?.({
        fileId: file.id,
        fileName: renamed.name,
      });
      result = renamed.name;
      break;
    }

    default:
      throw new Error(`Unknown gemihub-command: ${command}`);
  }

  if (saveTo) {
    context.variables.set(saveTo, result);
  }
  return result;
}
