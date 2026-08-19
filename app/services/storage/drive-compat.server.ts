/**
 * Project-mount compatibility layer for the legacy Drive-shaped client API
 * (/api/drive/files, /api/drive/tree).
 *
 * When the session has an active org project, those routes delegate here and
 * every `fileId` is the mount-relative path. Responses keep the Drive route
 * shapes ({ file, files, meta, content, ... }) so the ~25 existing client
 * call sites keep working unchanged — the same strategy the fork used for
 * chat tool names ("legacy client-facing drive* names may remain protocol
 * compatibility names").
 *
 * Drive-only actions (export, Google Workspace import, publish/unpublish,
 * encrypt/decrypt, markdown-pdf/html rendering) return 501 with a clear
 * message; they come back in later phases where they make sense for
 * project storage.
 */

import {
  deleteObject,
  listObjectsForSync,
  readObject,
  readObjectMetadata,
  renameObject,
  writeObject,
} from "./provider.server";
import type { MountContext, ObjectMeta, SyncObjectMeta } from "./types";
import { StorageConflictError, StorageNotFoundError } from "./types";
import { StorageQuotaExceededError } from "../storage-quota.server";
import { isProjectInternalPath } from "../sync-client-utils";

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
};

function guessMimeType(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return EXTENSION_MIME[name.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

const SAFE_INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

function isHiddenManagementPath(path: string): boolean {
  return path === "gemihub" || path.startsWith("gemihub/");
}

/** DriveFile-shaped view of a storage object; id/name are the path. */
function driveFileOf(meta: ObjectMeta) {
  return {
    id: meta.relativePath,
    name: meta.relativePath,
    mimeType: meta.contentType || guessMimeType(meta.relativePath),
    md5Checksum: meta.md5Hash,
    modifiedTime: meta.updatedAt ? new Date(meta.updatedAt).toISOString() : new Date().toISOString(),
    size: String(meta.size ?? 0),
  };
}

function metaEntryOf(row: SyncObjectMeta) {
  return {
    name: row.relativePath,
    mimeType: guessMimeType(row.relativePath),
    md5Checksum: row.md5Hash,
    modifiedTime: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
  };
}

async function listVisible(ctx: MountContext): Promise<SyncObjectMeta[]> {
  const rows = await listObjectsForSync(ctx);
  return rows.filter(
    (row) => !isProjectInternalPath(row.relativePath) && !isHiddenManagementPath(row.relativePath),
  );
}

/** SyncMeta-shaped piggyback keyed by path (the project-mount fileId). */
export async function projectMetaResponse(
  ctx: MountContext,
): Promise<{ lastUpdatedAt: string; files: Record<string, ReturnType<typeof metaEntryOf>> }> {
  const rows = await listVisible(ctx);
  return {
    lastUpdatedAt: new Date().toISOString(),
    files: Object.fromEntries(rows.map((row) => [row.relativePath, metaEntryOf(row)])),
  };
}

function notImplemented(action: string): Response {
  return Response.json(
    { error: `action "${action}" is not available in a project workspace yet` },
    { status: 501 },
  );
}

function storageError(err: unknown): Response | null {
  if (err instanceof StorageNotFoundError) {
    return Response.json({ error: "File not found (404)" }, { status: 404 });
  }
  if (err instanceof StorageQuotaExceededError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof StorageConflictError) {
    return Response.json({ error: "Remote file changed", conflict: true }, { status: 409 });
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/drive/files (loader actions)
// ---------------------------------------------------------------------------

export async function handleProjectFilesLoader(
  ctx: MountContext,
  url: URL,
): Promise<Response> {
  const action = url.searchParams.get("action");
  const fileId = url.searchParams.get("fileId");
  const query = url.searchParams.get("query");
  try {
    switch (action) {
      case "list": {
        const rows = await listVisible(ctx);
        const files = rows.map((row) => ({
          id: row.relativePath,
          name: row.relativePath,
          mimeType: guessMimeType(row.relativePath),
          md5Checksum: row.md5Hash,
          modifiedTime: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
        }));
        return Response.json({
          files,
          meta: {
            lastUpdatedAt: new Date().toISOString(),
            files: Object.fromEntries(rows.map((row) => [row.relativePath, metaEntryOf(row)])),
          },
        });
      }
      case "metadata": {
        if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
        const meta = await readObjectMetadata(ctx, fileId);
        if (!meta) return Response.json({ error: "File not found (404)" }, { status: 404 });
        const file = driveFileOf(meta);
        return Response.json({
          name: file.name,
          mimeType: file.mimeType,
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
          size: file.size,
          webViewLink: undefined,
        });
      }
      case "read": {
        if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
        const { meta, bytes } = await readObject(ctx, fileId);
        return Response.json({
          content: new TextDecoder("utf-8").decode(bytes),
          md5Checksum: meta.md5Hash,
          modifiedTime: meta.updatedAt ? new Date(meta.updatedAt).toISOString() : undefined,
        });
      }
      case "search": {
        if (!query) return Response.json({ error: "Missing query" }, { status: 400 });
        const rows = await listVisible(ctx);
        const q = query.toLowerCase();
        const files = rows
          .filter((row) => row.relativePath.toLowerCase().includes(q))
          .map((row) => ({
            id: row.relativePath,
            name: row.relativePath,
            mimeType: guessMimeType(row.relativePath),
            md5Checksum: row.md5Hash,
            modifiedTime: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
          }));
        return Response.json({ files });
      }
      case "raw": {
        if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
        const { meta, bytes } = await readObject(ctx, fileId);
        const fileName = meta.relativePath.split("/").pop() || meta.relativePath;
        // Same stored-XSS posture as api.storage.read: never render
        // user-supplied HTML/SVG inline on the app origin.
        const contentType =
          SAFE_INLINE_TYPES.has(meta.contentType) ||
          meta.contentType.startsWith("audio/") ||
          meta.contentType.startsWith("video/")
            ? meta.contentType
            : "application/octet-stream";
        const inlineAllowed = contentType !== "application/octet-stream";
        const disposition =
          url.searchParams.get("download") === "1" || !inlineAllowed ? "attachment" : "inline";
        return new Response(bytes as BlobPart, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `${disposition}; filename="${encodeURIComponent(fileName)}"`,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
          },
        });
      }
      case "export":
        return notImplemented("export");
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return storageError(err) ?? Response.json(
      { error: err instanceof Error ? err.message : "storage error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/drive/files (mutations)
// ---------------------------------------------------------------------------

interface FilesActionBody {
  action?: string;
  fileId?: string;
  name?: string;
  content?: string;
  data?: string;
  mimeType?: string;
  dedup?: boolean;
  permanent?: boolean;
  expectedFileId?: string;
  expectedMd5Checksum?: string;
  files?: Array<{ fileId: string; name: string }>;
  fileIds?: string[];
}

export async function handleProjectFilesAction(
  ctx: MountContext,
  body: FilesActionBody,
): Promise<Response> {
  const actionType = body.action;
  try {
    switch (actionType) {
      case "upsertChecked": {
        const { name, content } = body;
        if (typeof name !== "string" || !name || typeof content !== "string") {
          return Response.json({ error: "Missing name or content" }, { status: 400 });
        }
        const expectedFileId = typeof body.expectedFileId === "string" ? body.expectedFileId : null;
        const expectedMd5 = typeof body.expectedMd5Checksum === "string" ? body.expectedMd5Checksum : "";
        let written: ObjectMeta;
        if (expectedFileId) {
          const current = await readObjectMetadata(ctx, expectedFileId);
          if (!current || current.md5Hash !== expectedMd5) {
            return Response.json({ error: "Remote file changed", conflict: true }, { status: 409 });
          }
          written = await writeObject(ctx, expectedFileId, new TextEncoder().encode(content), {
            ifRevisionMatch: current.revision,
            contentType: body.mimeType || "text/markdown",
            updatedBy: ctx.gcs?.uid,
          });
        } else {
          const existing = await readObjectMetadata(ctx, name);
          if (existing) {
            return Response.json({ error: "Remote file was created", conflict: true }, { status: 409 });
          }
          written = await writeObject(ctx, name, new TextEncoder().encode(content), {
            ifRevisionMatch: 0,
            contentType: body.mimeType || "text/markdown",
            updatedBy: ctx.gcs?.uid,
          });
        }
        return Response.json({ file: driveFileOf(written), meta: await projectMetaResponse(ctx) });
      }
      case "findByName": {
        if (typeof body.name !== "string" || !body.name) {
          return Response.json({ error: "Missing name" }, { status: 400 });
        }
        const meta = await readObjectMetadata(ctx, body.name);
        return Response.json({ file: meta ? driveFileOf(meta) : null });
      }
      case "create": {
        const { name, content, dedup } = body;
        if (typeof name !== "string" || !name) {
          return Response.json({ error: "Missing name" }, { status: 400 });
        }
        if (dedup) {
          const existing = await readObjectMetadata(ctx, name);
          if (existing && typeof content === "string") {
            const updated = await writeObject(ctx, name, new TextEncoder().encode(content), {
              contentType: body.mimeType || "text/plain",
              updatedBy: ctx.gcs?.uid,
            });
            return Response.json({ file: driveFileOf(updated), meta: await projectMetaResponse(ctx) });
          }
        }
        const written = await writeObject(ctx, name, new TextEncoder().encode(content ?? ""), {
          contentType: body.mimeType || "text/yaml",
          updatedBy: ctx.gcs?.uid,
        });
        return Response.json({ file: driveFileOf(written), meta: await projectMetaResponse(ctx) });
      }
      case "create-image": {
        const { name, data } = body;
        if (!name || !data) return Response.json({ error: "Missing name or data" }, { status: 400 });
        const written = await writeObject(ctx, name, new Uint8Array(Buffer.from(data, "base64")), {
          contentType: body.mimeType || "image/png",
          updatedBy: ctx.gcs?.uid,
        });
        return Response.json({ file: driveFileOf(written), meta: await projectMetaResponse(ctx) });
      }
      case "update": {
        const { fileId, content } = body;
        if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
        const written = await writeObject(ctx, fileId, new TextEncoder().encode(content ?? ""), {
          contentType: body.mimeType || "text/plain",
          updatedBy: ctx.gcs?.uid,
        });
        return Response.json({
          file: driveFileOf(written),
          md5Checksum: written.md5Hash,
          meta: await projectMetaResponse(ctx),
        });
      }
      case "updateBinary": {
        const { fileId, content } = body;
        if (!fileId || content == null) {
          return Response.json({ error: "Missing fileId or content" }, { status: 400 });
        }
        const existing = await readObjectMetadata(ctx, fileId);
        const written = await writeObject(ctx, fileId, new Uint8Array(Buffer.from(content, "base64")), {
          contentType: existing?.contentType || "application/octet-stream",
          updatedBy: ctx.gcs?.uid,
        });
        return Response.json({
          file: driveFileOf(written),
          md5Checksum: written.md5Hash,
          meta: await projectMetaResponse(ctx),
        });
      }
      case "rename": {
        const { fileId, name } = body;
        if (!fileId || !name) return Response.json({ error: "Missing fileId or name" }, { status: 400 });
        const renamed = await renameObject(ctx, fileId, name);
        return Response.json({ file: driveFileOf(renamed), meta: await projectMetaResponse(ctx) });
      }
      case "bulkRename": {
        const files = body.files;
        if (!files || files.length === 0) return Response.json({ error: "Missing files" }, { status: 400 });
        const failedFileIds: string[] = [];
        const results: Array<{ fileId: string; ok: boolean }> = [];
        for (const f of files) {
          try {
            await renameObject(ctx, f.fileId, f.name);
            results.push({ fileId: f.fileId, ok: true });
          } catch {
            failedFileIds.push(f.fileId);
            results.push({ fileId: f.fileId, ok: false });
          }
        }
        return Response.json({ results, failedFileIds, meta: await projectMetaResponse(ctx) });
      }
      case "delete": {
        const { fileId } = body;
        if (!fileId) return Response.json({ error: "Missing fileId" }, { status: 400 });
        await deleteOrTrash(ctx, fileId, body.permanent === true);
        return Response.json({ ok: true, meta: await projectMetaResponse(ctx) });
      }
      case "bulkDelete": {
        const fileIds = body.fileIds;
        const permanent = body.permanent === true;
        if (!fileIds || fileIds.length === 0) return Response.json({ error: "Missing fileIds" }, { status: 400 });
        const failedFileIds: string[] = [];
        for (const fid of fileIds) {
          try {
            await deleteOrTrash(ctx, fid, permanent);
          } catch {
            failedFileIds.push(fid);
          }
        }
        return Response.json({ ok: true, failedFileIds, meta: await projectMetaResponse(ctx) });
      }
      case "import-google-workspace":
      case "create-markdown-pdf":
      case "create-markdown-html":
      case "encrypt":
      case "decrypt":
      case "publish":
      case "unpublish":
        return notImplemented(actionType);
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return storageError(err) ?? Response.json(
      { error: err instanceof Error ? err.message : "storage error" },
      { status: 500 },
    );
  }
}

/**
 * Delete with the app's trash semantics: non-permanent deletes move the
 * object under trash/ (matching the Drive flow's trash folder), permanent
 * deletes remove it. Already-missing objects are treated as deleted.
 */
async function deleteOrTrash(ctx: MountContext, path: string, permanent: boolean): Promise<void> {
  try {
    if (permanent) {
      await deleteObject(ctx, path);
      return;
    }
    let trashPath = `trash/${path.replace(/^\/+/, "")}`;
    const occupied = await readObjectMetadata(ctx, trashPath);
    if (occupied) trashPath = `trash/${Date.now()}-${path.replace(/^\/+/, "")}`;
    await renameObject(ctx, path, trashPath);
  } catch (err) {
    if (err instanceof StorageNotFoundError) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/drive/tree
// ---------------------------------------------------------------------------

export async function handleProjectTreeLoader(ctx: MountContext): Promise<Response> {
  interface TreeNode {
    id: string;
    name: string;
    mimeType: string;
    isFolder: boolean;
    modifiedTime?: string;
    children?: TreeNode[];
  }
  const rows = await listVisible(ctx);

  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode>();
  function ensureFolder(parts: string[]): TreeNode[] {
    if (parts.length === 0) return root;
    const fullPath = parts.join("/");
    const existing = folderMap.get(fullPath);
    if (existing) return existing.children!;
    const parentChildren = ensureFolder(parts.slice(0, -1));
    const node: TreeNode = {
      id: `vfolder:${fullPath}`,
      name: parts[parts.length - 1],
      mimeType: "application/vnd.google-apps.folder",
      isFolder: true,
      children: [],
    };
    parentChildren.push(node);
    folderMap.set(fullPath, node);
    return node.children!;
  }
  for (const row of rows) {
    const parts = row.relativePath.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const fileName = parts.pop()!;
    ensureFolder(parts).push({
      id: row.relativePath,
      name: fileName,
      mimeType: guessMimeType(fileName),
      isFolder: false,
      modifiedTime: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
    });
  }
  function sortChildren(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) if (node.children) sortChildren(node.children);
  }
  sortChildren(root);

  return Response.json({
    items: root,
    meta: {
      lastUpdatedAt: new Date().toISOString(),
      files: Object.fromEntries(rows.map((row) => [row.relativePath, metaEntryOf(row)])),
    },
  });
}
