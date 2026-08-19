/**
 * GET /api/storage/tree?mount=<mount>[&prefix=<relativePrefix>]
 *
 * Build a virtual folder tree for a storage mount. Mirrors the shape of
 * api.drive.tree (TreeNode array) but `id` is the mount-relative path
 * (deterministic) instead of an opaque Drive ID.
 *
 * Response:
 *   {
 *     items: TreeNode[],          // sorted folders-first, alphabetical
 *     fetchedAt: number,          // ms since epoch
 *     count: number               // total non-folder objects
 *   }
 */

import type { Route } from "./+types/api.storage.tree";
import { listObjectsForSync } from "~/services/storage/provider.server";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import { isProjectInternalPath } from "~/services/sync-client-utils";
import { getSettingsForTenant } from "~/services/user-settings-tenant.server";
import {
  badRequestResponse,
  errorResponse,
  requireQueryParam,
} from "~/services/storage-route-utils.server";
import type { MountContext, SyncObjectMeta } from "~/services/storage/types";
import type { ProjectAccessContext } from "~/types/enterprise";

interface TreeNode {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime?: string;
  md5Hash?: string;
  revision?: string;
  children?: TreeNode[];
}

const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

const EXTENSION_MIME: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  yaml: "text/yaml",
  yml: "text/yaml",
  json: "application/json",
  txt: "text/plain",
  html: "text/html",
  csv: "text/csv",
  js: "application/javascript",
  ts: "application/typescript",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  gdoc: "application/vnd.google-apps.document",
  gsheet: "application/vnd.google-apps.spreadsheet",
};

function guessMimeType(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION_MIME[ext] ?? "application/octet-stream";
}

function buildVirtualTree(files: SyncObjectMeta[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode>();
  const fileMap = new Map<string, TreeNode>();

  function ensureFolder(pathParts: string[]): TreeNode[] {
    if (pathParts.length === 0) return root;
    const fullPath = pathParts.join("/");
    const existing = folderMap.get(fullPath);
    if (existing) return existing.children!;
    const parentChildren = ensureFolder(pathParts.slice(0, -1));
    const folderName = pathParts[pathParts.length - 1];
    const folderNode: TreeNode = {
      id: `vfolder:${fullPath}`,
      name: folderName,
      mimeType: "application/x-directory",
      isFolder: true,
      children: [],
    };
    parentChildren.push(folderNode);
    folderMap.set(fullPath, folderNode);
    return folderNode.children!;
  }

  for (const f of files) {
    const parts = f.relativePath.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const fileName = parts.pop()!;
    const parentChildren = ensureFolder(parts);
    const normalizedPath = f.relativePath.replace(/^\/+/, "");
    if (fileMap.has(normalizedPath)) continue;
    const node: TreeNode = {
      id: f.relativePath,
      name: fileName,
      mimeType: guessMimeType(fileName),
      isFolder: false,
      modifiedTime: f.updatedAt ? new Date(f.updatedAt).toISOString() : undefined,
      md5Hash: f.md5Hash,
      revision: f.revision,
    };
    fileMap.set(normalizedPath, node);
    parentChildren.push(node);
  }

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

function safeTreeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "webpage_builder";
}

function nextSyntheticName(label: string, usedNames: Set<string>): string {
  const base = safeTreeFileName(label);
  const fileName = base.toLowerCase().endsWith(".gsheet") ? base : `${base}.gsheet`;
  const stem = fileName.slice(0, -".gsheet".length);
  for (let index = 0; index < 100; index++) {
    const candidate = index === 0 ? fileName : `${stem} (${index + 1}).gsheet`;
    const key = candidate.toLowerCase();
    if (!usedNames.has(key)) {
      usedNames.add(key);
      return candidate;
    }
  }
  return `${stem}-${Date.now()}.gsheet`;
}

function hubworkSpreadsheetNodes(
  ctx: ProjectAccessContext,
  existingRootNames: Set<string>,
): Promise<TreeNode[]> {
  return getSettingsForTenant(ctx)
    .then((settings) => {
      const seen = new Set<string>();
      const usedNames = new Set(existingRootNames);
      return (settings.hubwork?.spreadsheets ?? [])
        .filter((spreadsheet) => {
          const id = spreadsheet.id?.trim();
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((spreadsheet) => {
          const name = nextSyntheticName(spreadsheet.label?.trim() || "webpage_builder", usedNames);
          return {
            id: `google-workspace:spreadsheet:${spreadsheet.id.trim()}`,
            name,
            mimeType: GOOGLE_SHEET_MIME,
            isFolder: false,
          };
        });
    })
    .catch(() => []);
}

function isHiddenManagementPath(path: string): boolean {
  return path === "gemihub" || path.startsWith("gemihub/");
}

async function listTreeObjects(
  ctx: MountContext,
  relativePrefix?: string,
): Promise<SyncObjectMeta[]> {
  const rows = await listObjectsForSync(ctx, relativePrefix);
  return rows.filter(
    (row) =>
      !isProjectInternalPath(row.relativePath) &&
      !isHiddenManagementPath(row.relativePath),
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const mount = requireQueryParam(url, "mount");
    const relativePrefix = url.searchParams.get("prefix") ?? undefined;

    const ctx = await resolveMount(request, mount, "viewer");
    const objects = await listTreeObjects(ctx, relativePrefix);
    const items = buildVirtualTree(objects);
    if (!relativePrefix && ctx.kind === "gcs-project" && ctx.gcs) {
      const rootNames = new Set(
        objects
          .map((object) => object.relativePath)
          .filter((path) => !path.includes("/"))
          .map((path) => path.toLowerCase()),
      );
      items.push(...(await hubworkSpreadsheetNodes(ctx.gcs, rootNames)));
      items.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }
    return Response.json({
      items,
      fetchedAt: Date.now(),
      count: objects.length,
    });
  } catch (err) {
    return badRequestResponse(err) ?? errorResponse(err);
  }
}
