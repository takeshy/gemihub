import type { WorkflowNode, ExecutionContext, ServiceContext, PromptCallbacks } from "../types";
import { replaceVariables } from "./utils";
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
  const defaultPath = node.properties["default"]
    ? replaceVariables(node.properties["default"], context)
    : undefined;
  const saveTo = node.properties["saveTo"];
  const saveFileTo = node.properties["saveFileTo"];

  if (!saveTo && !saveFileTo) throw new Error("prompt-file node missing 'saveTo' or 'saveFileTo' property");

  if (!promptCallbacks?.promptForDriveFile) {
    throw new Error("Drive file picker callback not available");
  }

  const result = await promptCallbacks.promptForDriveFile(
    defaultPath || "Select a file"
  );
  if (result === null) throw new Error("File selection cancelled by user");

  // Read the file content
  const accessToken = serviceContext.driveAccessToken;
  const content = await driveService.readFile(accessToken, result.id);

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

// Handle preview node (was: open) - returns Drive web link
export async function handlePreviewNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _serviceContext: ServiceContext
): Promise<void> {
  const path = replaceVariables(node.properties["path"] || "", context);
  if (!path) throw new Error("preview node missing 'path' property");

  // For Drive, we just store the path - the client can open the Drive link
  const saveTo = node.properties["saveTo"];
  if (saveTo) {
    context.variables.set(saveTo, path);
  }
}

// Handle drive-file-picker node (was: file-explorer) - SSE-based file picker
export async function handleDriveFilePickerNode(
  node: WorkflowNode,
  context: ExecutionContext,
  _serviceContext: ServiceContext,
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
      const basename = directPath.includes("/") ? directPath.split("/").pop()! : directPath;
      const dotIdx = basename.lastIndexOf(".");
      const name = dotIdx > 0 ? basename.substring(0, dotIdx) : basename;
      const extension = dotIdx > 0 ? basename.substring(dotIdx + 1) : "";
      context.variables.set(saveTo, JSON.stringify({
        id: "",
        path: directPath,
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
    context.variables.set(saveTo, JSON.stringify({
      id: result.id,
      path: result.name,
      basename: result.name,
      name: result.name.replace(/\.[^.]+$/, ""),
      extension: result.name.split(".").pop() || "",
      mimeType: "application/octet-stream",
      contentType: "text",
      data: "",
    }));
  }
}
