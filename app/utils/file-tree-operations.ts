import {
  getCachedFile,
  setCachedFile,
  deleteCachedFile,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  getEditHistoryForFile,
  setEditHistoryEntry,
  deleteEditHistoryEntry,
  type CachedTreeNode,
  type CachedRemoteMeta,
} from "~/services/indexeddb-cache";
import { isSyncExcludedPath } from "~/services/sync-client-utils";
import type { FileListItem } from "~/contexts/EditorContext";

/**
 * Migrate a "new:" file to a new ID reflecting a new path.
 * Updates CachedFile, editHistory, and CachedRemoteMeta atomically.
 */
export async function migrateNewFileId(oldId: string, newId: string, newFileName: string): Promise<void> {
  // Migrate CachedFile
  const cached = await getCachedFile(oldId);
  if (cached) {
    await deleteCachedFile(oldId);
    await setCachedFile({ ...cached, fileId: newId, fileName: newFileName });
  }
  // Migrate editHistory
  const history = await getEditHistoryForFile(oldId);
  if (history) {
    await deleteEditHistoryEntry(oldId);
    await setEditHistoryEntry({ ...history, fileId: newId, filePath: newFileName });
  }
  // Migrate CachedRemoteMeta entry
  const meta = await getCachedRemoteMeta();
  if (meta?.files[oldId]) {
    const entry = meta.files[oldId];
    delete meta.files[oldId];
    meta.files[newId] = { ...entry, name: newFileName };
    await setCachedRemoteMeta(meta);
  }
}

export function removeNodeFromTree(
  nodes: CachedTreeNode[],
  targetId: string
): CachedTreeNode[] {
  return nodes
    .filter((n) => n.id !== targetId)
    .map((n) =>
      n.children
        ? { ...n, children: removeNodeFromTree(n.children, targetId) }
        : n
    );
}

export function buildTreeFromMeta(meta: CachedRemoteMeta): CachedTreeNode[] {
  const root: CachedTreeNode[] = [];
  const folderMap = new Map<string, CachedTreeNode>();

  function ensureFolder(pathParts: string[]): CachedTreeNode[] {
    if (pathParts.length === 0) return root;
    const fullPath = pathParts.join("/");
    const existing = folderMap.get(fullPath);
    if (existing) return existing.children!;
    const parentChildren = ensureFolder(pathParts.slice(0, -1));
    const folderName = pathParts[pathParts.length - 1];
    const folderNode: CachedTreeNode = {
      id: `vfolder:${fullPath}`,
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      isFolder: true,
      children: [],
    };
    parentChildren.push(folderNode);
    folderMap.set(fullPath, folderNode);
    return folderNode.children!;
  }

  for (const [fileId, f] of Object.entries(meta.files)) {
    // Skip system files (settings.json, _sync-meta.json, _encrypted-auth.json, etc.)
    if (isSyncExcludedPath(f.name)) continue;
    const parts = f.name.split("/");
    const fileName = parts.pop()!;
    const parentChildren = ensureFolder(parts);
    parentChildren.push({
      id: fileId,
      name: fileName,
      mimeType: f.mimeType,
      isFolder: false,
      modifiedTime: f.modifiedTime,
    });
  }

  function sortChildren(nodes: CachedTreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortChildren(node.children);
    }
  }

  sortChildren(root);
  return root;
}

export function flattenTree(nodes: CachedTreeNode[], parentPath: string, modifiedIds?: Set<string>): FileListItem[] {
  const result: FileListItem[] = [];
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.isFolder) {
      if (node.children) {
        result.push(...flattenTree(node.children, path, modifiedIds));
      }
    } else {
      result.push({ id: node.id, name: node.name, path, hasLocalChanges: modifiedIds?.has(node.id) });
    }
  }
  return result;
}

export function canConvertToHtml(name: string, mimeType: string): boolean {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith(".md") || mimeType === "text/markdown";
}

export function canConvertToPdf(name: string, mimeType: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    lowerName.endsWith(".md")
    || lowerName.endsWith(".html")
    || lowerName.endsWith(".htm")
    || mimeType === "text/markdown"
    || mimeType === "text/html"
  );
}

/** Find a file node by its full path (e.g. "folder/file.txt") */
export function findFileByPath(nodes: CachedTreeNode[], fullPath: string, parentPath: string = ""): CachedTreeNode | null {
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (!node.isFolder && path === fullPath) return node;
    if (node.isFolder && node.children) {
      const found = findFileByPath(node.children, fullPath, path);
      if (found) return found;
    }
  }
  return null;
}

/** Collect folder IDs that contain at least one modified file */
export function collectModifiedFolderIds(
  nodes: CachedTreeNode[],
  modifiedFiles: Set<string>
): Set<string> {
  const result = new Set<string>();
  function walk(nodes: CachedTreeNode[]): boolean {
    let hasModified = false;
    for (const node of nodes) {
      if (node.isFolder && node.children) {
        if (walk(node.children)) {
          result.add(node.id);
          hasModified = true;
        }
      } else if (modifiedFiles.has(node.id)) {
        hasModified = true;
      }
    }
    return hasModified;
  }
  walk(nodes);
  return result;
}

/** Find all ancestor folder IDs for a given file ID in the tree */
export function findAncestorFolderIds(
  nodes: CachedTreeNode[],
  targetId: string
): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return [];
    if (node.isFolder && node.children) {
      const result = findAncestorFolderIds(node.children, targetId);
      if (result !== null) return [node.id, ...result];
    }
  }
  return null;
}
