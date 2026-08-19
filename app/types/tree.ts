/**
 * Tree types for the GCS-backed file tree (enterprise mode).
 *
 * CachedTreeNode represents a node in the virtual folder tree returned
 * by /api/storage/tree. The `id` field is the relative object path
 * (e.g. "notes/memo.md") for files and a virtual folder identifier
 * (e.g. "vfolder:notes") for folders.
 */

export interface CachedTreeNode {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime?: string;
  children?: CachedTreeNode[];
}

export interface CachedFileTree {
  id: "current";
  rootFolderId: string;
  items: CachedTreeNode[];
  cachedAt: number;
}
