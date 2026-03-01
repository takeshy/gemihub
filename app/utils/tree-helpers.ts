import type { CachedTreeNode } from "~/services/indexeddb-cache";

/** Resolve virtual folder path from a vfolder: ID */
export function getFolderPath(folderId: string): string {
  if (folderId.startsWith("vfolder:")) {
    return folderId.slice("vfolder:".length);
  }
  return ""; // root
}

/** Find the full Drive file name (with path prefix) for a node */
export function findFullFileName(
  nodeId: string,
  nodes: CachedTreeNode[],
  parentPath: string,
): string | null {
  for (const node of nodes) {
    const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.id === nodeId) return fullPath;
    if (node.children) {
      const found = findFullFileName(nodeId, node.children, fullPath);
      if (found) return found;
    }
  }
  return null;
}

/** Collect all files under a node with their full paths */
export function collectFilesWithPaths(
  node: CachedTreeNode,
  parentPath: string,
): { id: string; fullPath: string }[] {
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  if (!node.isFolder) return [{ id: node.id, fullPath }];
  const files: { id: string; fullPath: string }[] = [];
  for (const child of node.children ?? []) {
    files.push(...collectFilesWithPaths(child, fullPath));
  }
  return files;
}

/** Find a tree node by its ID */
export function findNodeById(
  nodeId: string,
  nodes: CachedTreeNode[],
): CachedTreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNodeById(nodeId, node.children);
      if (found) return found;
    }
  }
  return null;
}

/** Collect all real file IDs under a tree node */
export function collectFileIds(node: CachedTreeNode): string[] {
  if (!node.isFolder) return [node.id];
  const ids: string[] = [];
  for (const child of node.children ?? []) {
    ids.push(...collectFileIds(child));
  }
  return ids;
}
