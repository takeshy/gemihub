import type { Route } from "./+types/api.drive.tree";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import type { DriveFile } from "~/services/google-drive.server";
import {
  getFileListFromMeta,
  rebuildSyncMeta,
  type SyncMeta,
} from "~/services/sync-meta.server";

interface TreeNode {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime?: string;
  children?: TreeNode[];
}

function buildVirtualTree(files: DriveFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  // Map for virtual folder nodes: "path/to/folder" -> TreeNode
  const folderMap = new Map<string, TreeNode>();

  function ensureFolder(pathParts: string[]): TreeNode[] {
    if (pathParts.length === 0) return root;

    const fullPath = pathParts.join("/");
    const existing = folderMap.get(fullPath);
    if (existing) return existing.children!;

    // Ensure parent exists
    const parentChildren = ensureFolder(pathParts.slice(0, -1));
    const folderName = pathParts[pathParts.length - 1];

    const folderNode: TreeNode = {
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

  for (const file of files) {
    const parts = file.name.split("/");
    const fileName = parts.pop()!;
    const parentChildren = ensureFolder(parts);

    parentChildren.push({
      id: file.id,
      name: fileName,
      mimeType: file.mimeType,
      isFolder: false,
      modifiedTime: file.modifiedTime,
    });
  }

  // Sort: folders first (alphabetically), then files (alphabetically)
  function sortChildren(nodes: TreeNode[]): void {
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

function metaToResponse(meta: SyncMeta) {
  return {
    lastUpdatedAt: meta.lastUpdatedAt,
    files: meta.files,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId");
  const refresh = url.searchParams.get("refresh") === "true";

  if (!folderId) {
    return Response.json({ error: "Missing folderId" }, { status: 400, headers: responseHeaders });
  }

  let meta: SyncMeta;
  let files: DriveFile[];

  if (refresh) {
    // Force rebuild from Drive API
    meta = await rebuildSyncMeta(validTokens.accessToken, folderId);
    files = Object.entries(meta.files).map(([id, f]) => ({
      id,
      name: f.name,
      mimeType: f.mimeType,
      md5Checksum: f.md5Checksum,
      modifiedTime: f.modifiedTime,
      createdTime: f.createdTime,
    }));
  } else {
    // Read from meta file (fast path)
    const result = await getFileListFromMeta(validTokens.accessToken, folderId);
    meta = result.meta;
    files = result.files;
  }

  const items = buildVirtualTree(files);
  return Response.json({ items, meta: metaToResponse(meta) }, { headers: responseHeaders });
}
