import type { WorkflowNode, ExecutionContext, ServiceContext, FileExplorerData, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";
import { isBinaryMimeType, resolveExistingFile, readBinaryFileAsExplorerData } from "./driveUtils";
import * as driveService from "~/services/google-drive.server";

// Handle prompt-value node (was: prompt-file + prompt-selection)
// SSE-based: sends prompt request to client, waits for response
export async function handlePromptValueNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _serviceContext: ServiceContext,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const title = replaceVariables(node.properties["title"] || "Input", context);
  const defaultValue = node.properties["default"]
    ? replaceVariables(node.properties["default"], context)
    : undefined;
  const multiline = node.properties["multiline"] === "true";
  const saveTo = node.properties["saveTo"];

  if (!saveTo) throw new Error("prompt-value node missing 'saveTo' property");

  if (!promptCallbacks?.promptForValue) {
    throw new Error("Prompt callback not available");
  }

  const result = await promptCallbacks.promptForValue(title, defaultValue, multiline);

  if (result === null) {
    throw new Error("Input cancelled by user");
  }

  context.variables.set(saveTo, result);
}

// Handle prompt-file node - file picker that returns content as string
export async function handlePromptFileNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const title = node.properties["title"]
    ? replaceVariables(node.properties["title"], context)
    : "Select a file";
  const saveTo = node.properties["saveTo"];
  const saveFileTo = node.properties["saveFileTo"];

  if (!saveTo && !saveFileTo) throw new Error("prompt-file node missing 'saveTo' or 'saveFileTo' property");

  if (!promptCallbacks?.promptForDriveFile) {
    throw new Error("Drive file picker callback not available");
  }

  const result = await promptCallbacks.promptForDriveFile(title);
  if (result === null) throw new Error("File selection cancelled by user");

  // Read the file content
  const accessToken = serviceContext.driveAccessToken;
  const content = await driveService.readFile(accessToken, result.id, {
    signal: serviceContext.abortSignal,
  });

  if (saveTo) {
    context.variables.set(saveTo, content);
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

// Handle prompt-selection node - multiline text input
export async function handlePromptSelectionNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _serviceContext: ServiceContext,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const title = replaceVariables(node.properties["title"] || "Enter text", context);
  const saveTo = node.properties["saveTo"];

  if (!saveTo) throw new Error("prompt-selection node missing 'saveTo' property");

  if (!promptCallbacks?.promptForValue) {
    throw new Error("Prompt callback not available");
  }

  const result = await promptCallbacks.promptForValue(title, "", true);

  if (result === null) {
    throw new Error("Input cancelled by user");
  }

  context.variables.set(saveTo, result);
}

// Handle dialog node - SSE-based dialog with options
export async function handleDialogNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _serviceContext: ServiceContext,
  promptCallbacks?: PromptCallbacks
): Promise<void> {
  const title = replaceVariables(node.properties["title"] || "Dialog", context);
  const message = replaceVariables(node.properties["message"] || "", context);
  const optionsStr = replaceVariables(node.properties["options"] || "", context);
  const multiSelect = node.properties["multiSelect"] === "true";
  const markdown = node.properties["markdown"] === "true";
  const button1 = replaceVariables(node.properties["button1"] || "OK", context);
  const button2Prop = node.properties["button2"];
  const button2 = button2Prop ? replaceVariables(button2Prop, context) : undefined;
  const inputTitleProp = node.properties["inputTitle"];
  const inputTitle = inputTitleProp ? replaceVariables(inputTitleProp, context) : undefined;
  const multiline = node.properties["multiline"] === "true";
  const defaultsProp = node.properties["defaults"];
  const saveTo = node.properties["saveTo"];

  let defaults: { input?: string; selected?: string[] } | undefined;
  if (defaultsProp) {
    try {
      const parsed = JSON.parse(replaceVariables(defaultsProp, context));
      defaults = {
        input: parsed.input,
        selected: Array.isArray(parsed.selected) ? parsed.selected : undefined,
      };
    } catch { /* ignore */ }
  }

  const options = optionsStr
    ? optionsStr.split(",").map(o => o.trim()).filter(o => o.length > 0)
    : [];

  if (!promptCallbacks?.promptForDialog) {
    throw new Error("Dialog prompt callback not available");
  }

  const result = await promptCallbacks.promptForDialog(
    title, message, options, multiSelect, button1, button2,
    markdown, inputTitle, defaults, multiline
  );

  if (result === null) throw new Error("Dialog cancelled by user");

  if (saveTo) {
    context.variables.set(saveTo, JSON.stringify(result));
  }
}

// Handle drive-file-picker node (was: file-explorer) - SSE-based file picker
export async function handleDriveFilePickerNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
  promptCallbacks?: PromptCallbacks
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

  // "create" mode: prompt user for a path string instead of picking existing file
  if (mode === "create") {
    if (!promptCallbacks?.promptForValue) {
      throw new Error("Prompt callback not available");
    }
    const path = await promptCallbacks.promptForValue(title, defaultValue);
    if (path === null) throw new Error("File creation cancelled by user");

    if (savePathTo) context.variables.set(savePathTo, path);
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

  // If path is directly specified, use it
  const directPath = node.properties["path"]
    ? replaceVariables(node.properties["path"], context)
    : undefined;

  if (directPath) {
    if (savePathTo) context.variables.set(savePathTo, directPath);
    if (saveTo) {
      const explorerData = await readDriveFileAsExplorerData(directPath, context, serviceContext);
      context.variables.set(saveTo, JSON.stringify(explorerData));
    }
    return;
  }

  if (!promptCallbacks?.promptForDriveFile) {
    throw new Error("Drive file picker callback not available");
  }

  const result = await promptCallbacks.promptForDriveFile(title, extensions);
  if (result === null) throw new Error("File selection cancelled by user");

  if (savePathTo) {
    context.variables.set(savePathTo, result.name);
    // Also store the file ID so drive-read can skip name-based search
    context.variables.set(`${savePathTo}_fileId`, result.id);
  }
  if (saveTo) {
    const meta = await driveService.getFileMetadata(serviceContext.driveAccessToken, result.id, {
      signal: serviceContext.abortSignal,
    });
    const explorerData = await readDriveFileAsExplorerDataById(
      result.id, result.name, meta.mimeType || "application/octet-stream", serviceContext
    );
    context.variables.set(saveTo, JSON.stringify(explorerData));
  }
}

// ---------------------------------------------------------------------------
// Helpers: read Drive file content into FileExplorerData
// ---------------------------------------------------------------------------

async function readDriveFileAsExplorerData(
  path: string,
  context: ExecutionContext,
  serviceContext: ServiceContext,
): Promise<FileExplorerData> {
  const file = await resolveExistingFile(path, context, serviceContext, { tryMdExtension: true });
  return readDriveFileAsExplorerDataById(file.id, file.name, file.mimeType, serviceContext);
}

async function readDriveFileAsExplorerDataById(
  fileId: string,
  fileName: string,
  mimeType: string,
  serviceContext: ServiceContext,
): Promise<FileExplorerData> {
  const accessToken = serviceContext.driveAccessToken;
  const isBinary = isBinaryMimeType(mimeType);

  if (isBinary) {
    return JSON.parse(
      await readBinaryFileAsExplorerData(accessToken, fileId, fileName, mimeType, serviceContext.abortSignal)
    );
  }

  const ext = fileName.includes(".") ? fileName.split(".").pop()! : "";
  const name = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
  const data = await driveService.readFile(accessToken, fileId, { signal: serviceContext.abortSignal });
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
