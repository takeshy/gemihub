import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";
import * as driveService from "~/services/google-drive.server";

// Handle drive-search node (was: note-search)
export async function handleDriveSearchNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const query = replaceVariables(node.properties["query"] || "", context);
  const searchContent = node.properties["searchContent"] === "true";
  const saveTo = node.properties["saveTo"];

  if (!query) throw new Error("drive-search node missing 'query' property");
  if (!saveTo) throw new Error("drive-search node missing 'saveTo' property");

  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;

  const limitStr = node.properties["limit"];
  const limit = limitStr ? (parseInt(replaceVariables(limitStr, context), 10) || 10) : 10;

  const files = await driveService.searchFiles(accessToken, folderId, query, searchContent);

  const results = files.slice(0, limit).map(f => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
  }));

  context.variables.set(saveTo, JSON.stringify(results));
}
