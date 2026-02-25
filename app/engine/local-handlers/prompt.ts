/**
 * Local prompt-file and drive-file-picker handlers.
 * Reads file content from IndexedDB instead of Drive API.
 */
import type { WorkflowNode, ExecutionContext, FileExplorerData, PromptCallbacks } from "../types";
import { replaceVariables } from "../handlers/utils";
import {
  resolveFileLocal,
  readFileLocal,
  readFileBinaryLocal,
} from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { isBinaryMimeType } from "./mime-utils";

// ---------------------------------------------------------------------------
// prompt-file
// ---------------------------------------------------------------------------

export async function handlePromptFileNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
  promptCallbacks: PromptCallbacks,
): Promise<void> {
  const title = node.properties["title"]
    ? replaceVariables(node.properties["title"], context)
    : "Select a file";
  const saveTo = node.properties["saveTo"];
  const saveFileTo = node.properties["saveFileTo"];

  if (!saveTo && !saveFileTo) throw new Error("prompt-file node missing 'saveTo' or 'saveFileTo' property");

  if (!promptCallbacks.promptForDriveFile) {
    throw new Error("Drive file picker callback not available");
  }

  const result = await promptCallbacks.promptForDriveFile(title);
  if (result === null) throw new Error("File selection cancelled by user");

  if (saveTo) {
    // Check mime type from remote meta
    const meta = await getCachedRemoteMeta();
    const fileMeta = meta?.files[result.id];
    const mimeType = fileMeta?.mimeType || "text/plain";

    if (isBinaryMimeType(mimeType)) {
      const base64 = await readFileBinaryLocal(result.id);
      const ext = result.name.includes(".") ? result.name.split(".").pop()! : "";
      const name = result.name.includes(".") ? result.name.slice(0, result.name.lastIndexOf(".")) : result.name;
      const fileData: FileExplorerData = {
        id: result.id,
        path: result.name,
        basename: result.name,
        name,
        extension: ext,
        mimeType,
        contentType: "binary",
        data: base64,
      };
      context.variables.set(saveTo, JSON.stringify(fileData));
    } else {
      const content = await readFileLocal(result.id);
      context.variables.set(saveTo, content);
    }
  }

  if (saveFileTo) {
    const basename = result.name;
    const dotIdx = basename.lastIndexOf(".");
    const name = dotIdx > 0 ? basename.substring(0, dotIdx) : basename;
    const extension = dotIdx > 0 ? basename.substring(dotIdx + 1) : "";
    context.variables.set(saveFileTo, JSON.stringify({
      path: result.name,
      basename,
      name,
      extension,
    }));
  }
}

// ---------------------------------------------------------------------------
// drive-file-picker
// ---------------------------------------------------------------------------

export async function handleDriveFilePickerNodeLocal(
  node: WorkflowNode,
  context: ExecutionContext,
  promptCallbacks: PromptCallbacks,
): Promise<void> {
  const title = replaceVariables(node.properties["title"] || "Select a file", context);
  const extensionsStr = node.properties["extensions"] || "";
  const extensions = extensionsStr
    ? extensionsStr.split(",").map(e => e.trim())
    : undefined;
  const saveTo = node.properties["saveTo"];
  const savePathTo = node.properties["savePathTo"];
  const mode = node.properties["mode"] || "select";
  const defaultValue = node.properties["default"]
    ? replaceVariables(node.properties["default"], context)
    : undefined;

  if (!saveTo && !savePathTo) {
    throw new Error("drive-file-picker node missing 'saveTo' or 'savePathTo'");
  }

  // "create" mode: prompt for a path string
  if (mode === "create") {
    if (!promptCallbacks.promptForValue) {
      throw new Error("Prompt callback not available");
    }
    const path = await promptCallbacks.promptForValue(title, defaultValue);
    if (path === null) throw new Error("File creation cancelled by user");

    if (savePathTo) {
      context.variables.set(savePathTo, path);
      context.variables.set(`${savePathTo}_fileId`, "");
    }
    if (saveTo) {
      const basename = path.includes("/") ? path.split("/").pop()! : path;
      const dotIdx = basename.lastIndexOf(".");
      const name = dotIdx > 0 ? basename.substring(0, dotIdx) : basename;
      const extension = dotIdx > 0 ? basename.substring(dotIdx + 1) : "";
      context.variables.set(saveTo, JSON.stringify({
        id: "",
        path,
        basename,
        name,
        extension,
        mimeType: "application/octet-stream",
        contentType: "text",
        data: "",
      }));
    }
    return;
  }

  // If path is directly specified
  const directPath = node.properties["path"]
    ? replaceVariables(node.properties["path"], context)
    : undefined;

  if (directPath) {
    if (savePathTo) context.variables.set(savePathTo, directPath);
    if (saveTo) {
      const file = await resolveFileLocal(directPath, context, { tryMdExtension: true });
      const explorerData = await readFileAsExplorerDataLocal(file.id, file.name, file.mimeType);
      context.variables.set(saveTo, JSON.stringify(explorerData));
    }
    return;
  }

  if (!promptCallbacks.promptForDriveFile) {
    throw new Error("Drive file picker callback not available");
  }

  const result = await promptCallbacks.promptForDriveFile(title, extensions);
  if (result === null) throw new Error("File selection cancelled by user");

  if (savePathTo) {
    context.variables.set(savePathTo, result.name);
    context.variables.set(`${savePathTo}_fileId`, result.id);
  }
  if (saveTo) {
    const meta = await getCachedRemoteMeta();
    const fileMeta = meta?.files[result.id];
    const mimeType = fileMeta?.mimeType || "text/plain";
    const explorerData = await readFileAsExplorerDataLocal(result.id, result.name, mimeType);
    context.variables.set(saveTo, JSON.stringify(explorerData));
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function readFileAsExplorerDataLocal(
  fileId: string,
  fileName: string,
  mimeType: string,
): Promise<FileExplorerData> {
  const ext = fileName.includes(".") ? fileName.split(".").pop()! : "";
  const name = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;

  if (isBinaryMimeType(mimeType)) {
    const base64 = await readFileBinaryLocal(fileId);
    return {
      id: fileId,
      path: fileName,
      basename: fileName,
      name,
      extension: ext,
      mimeType,
      contentType: "binary",
      data: base64,
    };
  }

  const data = await readFileLocal(fileId);
  return {
    id: fileId,
    path: fileName,
    basename: fileName,
    name,
    extension: ext,
    mimeType,
    contentType: "text",
    data,
  };
}
