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
): { id: string; fullPath: string; mimeType?: string }[] {
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  if (!node.isFolder) return [{ id: node.id, fullPath, mimeType: node.mimeType }];
  const files: { id: string; fullPath: string; mimeType?: string }[] = [];
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

/** Validate a destination before moving a file or an entire virtual folder. */
export function getMoveTargetIssue(
  nodes: CachedTreeNode[],
  itemId: string,
  targetId: string,
  rootFolderId: string,
): "sameFolder" | "descendant" | "nameConflict" | "missing" | null {
  const item = findNodeById(itemId, nodes);
  const sourcePath = findFullFileName(itemId, nodes, "");
  const target = targetId === rootFolderId ? null : findNodeById(targetId, nodes);
  if (!item || !sourcePath || (targetId !== rootFolderId && !target?.isFolder)) return "missing";
  const targetPath = targetId === rootFolderId ? "" : findFullFileName(targetId, nodes, "")!;
  if (item.isFolder && (targetPath === sourcePath || targetPath.startsWith(`${sourcePath}/`))) return "descendant";
  const parentPath = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  if (targetPath === parentPath) return "sameFolder";
  const siblings = targetId === rootFolderId ? nodes : target?.children ?? [];
  if (siblings.some((node) => node.name === item.name)) return "nameConflict";
  return null;
}

/** Reparent a local node without rebuilding the tree and losing empty folders. */
export function moveNodeInTree(
  nodes: CachedTreeNode[],
  itemId: string,
  targetId: string,
  rootFolderId: string,
  movedNode: CachedTreeNode,
): CachedTreeNode[] {
  if (getMoveTargetIssue(nodes, itemId, targetId, rootFolderId)) return nodes;
  const sort = (items: CachedTreeNode[]) => items.sort((a, b) =>
    a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.name.localeCompare(b.name));
  const remove = (items: CachedTreeNode[]): CachedTreeNode[] => items
    .filter((node) => node.id !== itemId)
    .map((node) => node.children ? { ...node, children: remove(node.children) } : node);
  const remaining = remove(nodes);
  if (targetId === rootFolderId) return sort([...remaining, movedNode]);
  const insert = (items: CachedTreeNode[]): CachedTreeNode[] => items.map((node) => {
    if (node.id === targetId) return { ...node, children: sort([...(node.children ?? []), movedNode]) };
    return node.children ? { ...node, children: insert(node.children) } : node;
  });
  return insert(remaining);
}
