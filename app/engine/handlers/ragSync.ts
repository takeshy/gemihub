import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";
import * as driveService from "~/services/google-drive.server";
import { uploadDriveFile, getOrCreateStore } from "~/services/file-search.server";

// Handle rag-sync node - sync a Drive file to a RAG store
export async function handleRagSyncNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const path = replaceVariables(node.properties["path"] || "", context);
  const ragSettingName = replaceVariables(node.properties["ragSetting"] || "", context);
  const saveTo = node.properties["saveTo"];

  if (!path) throw new Error("rag-sync node missing 'path' property");
  if (!ragSettingName) throw new Error("rag-sync node missing 'ragSetting' property");

  const apiKey = serviceContext.geminiApiKey;
  if (!apiKey) throw new Error("Gemini API key not configured");

  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;

  // Find the file on Drive
  const files = await driveService.searchFiles(accessToken, folderId, path, false);
  let file = files.find(f => f.name === path || f.name === `${path}.md`);
  if (!file) {
    file = await driveService.findFileByExactName(accessToken, path) ?? undefined;
    if (!file && !path.endsWith(".md")) {
      file = await driveService.findFileByExactName(accessToken, `${path}.md`) ?? undefined;
    }
  }
  if (!file) throw new Error(`File not found on Drive: ${path}`);

  // Get or create the RAG store
  const storeName = await getOrCreateStore(apiKey, ragSettingName);

  // Upload the file to the RAG store
  const fileId = await uploadDriveFile(apiKey, accessToken, file.id, file.name, storeName);

  const result = {
    path,
    ragSetting: ragSettingName,
    fileId: fileId || file.id,
    mode: "upload",
    syncedAt: new Date().toISOString(),
  };

  if (saveTo) {
    context.variables.set(saveTo, JSON.stringify(result));
  }
}
