import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";
import { getFileListFromMeta } from "~/services/sync-meta.server";

function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)\s*(d|h|m)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "d": return num * 24 * 60 * 60 * 1000;
    case "h": return num * 60 * 60 * 1000;
    case "m": return num * 60 * 1000;
    default: return null;
  }
}

// Handle drive-list node (was: note-list)
export async function handleDriveListNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const folder = replaceVariables(node.properties["folder"] || "", context);
  const limitStr = node.properties["limit"] || "50";
  const limit = parseInt(limitStr, 10) || 50;
  const sortBy = replaceVariables(node.properties["sortBy"] || "modified", context);
  const sortOrder = replaceVariables(node.properties["sortOrder"] || "desc", context);
  const modifiedWithin = node.properties["modifiedWithin"]
    ? replaceVariables(node.properties["modifiedWithin"], context) : undefined;
  const createdWithin = node.properties["createdWithin"]
    ? replaceVariables(node.properties["createdWithin"], context) : undefined;
  const saveTo = node.properties["saveTo"];

  if (!saveTo) throw new Error("drive-list node missing 'saveTo' property");

  const accessToken = serviceContext.driveAccessToken;

  // List all user files from meta (fast path)
  const { files: allFiles } = await getFileListFromMeta(accessToken, serviceContext.driveRootFolderId);

  // Filter by virtual folder prefix
  const prefix = folder ? folder + "/" : "";
  let filtered = folder
    ? allFiles.filter(f => f.name.startsWith(prefix))
    : allFiles;

  // Time-based filters
  const now = Date.now();
  if (modifiedWithin) {
    const ms = parseDuration(modifiedWithin);
    if (ms) {
      const cutoff = now - ms;
      filtered = filtered.filter(f =>
        f.modifiedTime && new Date(f.modifiedTime).getTime() >= cutoff
      );
    }
  }
  if (createdWithin) {
    const ms = parseDuration(createdWithin);
    if (ms) {
      const cutoff = now - ms;
      filtered = filtered.filter(f =>
        f.createdTime && new Date(f.createdTime).getTime() >= cutoff
      );
    }
  }

  // Sort
  filtered.sort((a, b) => {
    let aVal: string | number = 0;
    let bVal: string | number = 0;
    if (sortBy === "name") {
      aVal = a.name.toLowerCase();
      bVal = b.name.toLowerCase();
    } else if (sortBy === "created") {
      aVal = a.createdTime ? new Date(a.createdTime).getTime() : 0;
      bVal = b.createdTime ? new Date(b.createdTime).getTime() : 0;
    } else {
      // "modified" (default)
      aVal = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      bVal = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
    }
    if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
    if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const limitedFiles = filtered.slice(0, limit);

  const results = limitedFiles.map(f => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
  }));

  context.variables.set(
    saveTo,
    JSON.stringify({
      notes: results,
      count: results.length,
      totalCount: filtered.length,
      hasMore: filtered.length > limit,
    })
  );
}

// Handle drive-folder-list node (was: folder-list)
// In flat storage, "folders" are virtual — derived from path prefixes in file names
export async function handleDriveFolderListNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const parentFolder = replaceVariables(node.properties["folder"] || "", context);
  const saveTo = node.properties["saveTo"];

  if (!saveTo) throw new Error("drive-folder-list node missing 'saveTo' property");

  const accessToken = serviceContext.driveAccessToken;
  const { files: allFiles } = await getFileListFromMeta(accessToken, serviceContext.driveRootFolderId);

  // Extract immediate virtual subfolder names under parentFolder
  const prefix = parentFolder ? parentFolder + "/" : "";
  const folderNames = new Set<string>();

  for (const f of allFiles) {
    const name = parentFolder ? (f.name.startsWith(prefix) ? f.name.slice(prefix.length) : null) : f.name;
    if (name === null) continue;
    const slashIndex = name.indexOf("/");
    if (slashIndex !== -1) {
      folderNames.add(name.slice(0, slashIndex));
    }
  }

  const sortedFolders = Array.from(folderNames).sort();

  context.variables.set(
    saveTo,
    JSON.stringify({
      folders: sortedFolders.map(name => ({ name })),
      count: sortedFolders.length,
    })
  );
}
