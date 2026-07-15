import {
  deleteEditHistoryEntry,
  getCachedRemoteMeta,
  getLocalSyncMeta,
  setCachedFile,
  setCachedRemoteMeta,
  setLocalSyncMeta,
  type CachedRemoteMeta,
} from "./indexeddb-cache";
import { findFileByNameLocal, readFileLocal, writeFileLocal } from "./drive-local";
import { migratePendingFiles } from "./pending-file-migration";

interface RemoteFile {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
}

interface RemoteMetaResponse {
  lastUpdatedAt: string;
  files: CachedRemoteMeta["files"];
}

async function applyRemoteFile(
  file: RemoteFile,
  content: string,
  meta?: RemoteMetaResponse,
  notify = true,
): Promise<void> {
  const modifiedTime = file.modifiedTime ?? new Date().toISOString();
  await setCachedFile({
    fileId: file.id,
    fileName: file.name,
    content,
    md5Checksum: file.md5Checksum ?? "",
    modifiedTime,
    cachedAt: Date.now(),
  });
  await deleteEditHistoryEntry(file.id);

  const cachedRemote = await getCachedRemoteMeta();
  if (cachedRemote) {
    await setCachedRemoteMeta({
      ...cachedRemote,
      lastUpdatedAt: meta?.lastUpdatedAt ?? cachedRemote.lastUpdatedAt,
      files: {
        ...cachedRemote.files,
        [file.id]: meta?.files[file.id] ?? {
          name: file.name,
          mimeType: file.mimeType,
          md5Checksum: file.md5Checksum ?? "",
          modifiedTime,
          createdTime: file.createdTime ?? modifiedTime,
          size: file.size,
        },
      },
      cachedAt: Date.now(),
    });
  }

  const localMeta = await getLocalSyncMeta();
  if (localMeta) {
    const remoteEntry = meta?.files[file.id];
    localMeta.files[file.id] = {
      md5Checksum: remoteEntry?.md5Checksum ?? file.md5Checksum ?? "",
      modifiedTime: remoteEntry?.modifiedTime ?? modifiedTime,
      name: remoteEntry?.name ?? file.name,
      size: remoteEntry?.size ?? file.size,
    };
    localMeta.lastUpdatedAt = meta?.lastUpdatedAt ?? localMeta.lastUpdatedAt;
    await setLocalSyncMeta(localMeta);
  }
  if (notify) window.dispatchEvent(new Event("sync-complete"));
}

async function findRemoteByName(name: string): Promise<RemoteFile | null> {
  const response = await fetch("/api/drive/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "findByName", name }),
  });
  if (!response.ok) throw new Error("Failed to find Timeline file on Drive");
  const data = await response.json() as { file?: RemoteFile | null };
  return data.file ?? null;
}

async function readRemote(file: RemoteFile): Promise<{ content: string; md5Checksum: string }> {
  const response = await fetch(
    `/api/drive/files?action=read&fileId=${encodeURIComponent(file.id)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Failed to read Timeline file from Drive");
  return response.json() as Promise<{ content: string; md5Checksum: string }>;
}

/** Read-modify-write a Timeline Markdown file, retrying when another client wins the race. */
export async function mutateTimelineFile(
  name: string,
  mutate: (current: string) => string | null,
): Promise<string> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const local = await findFileByNameLocal(name);
    const current = local ? await readFileLocal(local.id) : "";
    const next = mutate(current);
    if (next == null) throw new Error("Timeline entry no longer exists");
    await writeFileLocal(name, next, local ? { existingFileId: local.id } : undefined);
    return next;
  }

  // Flush a Timeline file created while offline before resolving the remote
  // snapshot. This prevents a second file with the same path from being
  // created when connectivity returns.
  await migratePendingFiles();

  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await findRemoteByName(name);
    const snapshot = remote ? await readRemote(remote) : { content: "", md5Checksum: "" };
    const next = mutate(snapshot.content);
    if (next == null) throw new Error("Timeline entry no longer exists");
    const response = await fetch("/api/drive/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsertChecked",
        name,
        content: next,
        mimeType: "text/markdown",
        expectedFileId: remote?.id,
        expectedMd5Checksum: snapshot.md5Checksum,
      }),
    });
    if (response.status === 409) continue;
    if (!response.ok) throw new Error("Failed to update Timeline file on Drive");
    const data = await response.json() as { file: RemoteFile; meta?: RemoteMetaResponse };
    await applyRemoteFile(data.file, next, data.meta);
    return next;
  }
  throw new Error("Timeline file kept changing on Drive");
}

/** Pull the latest Markdown files for one Timeline directory into the local cache. */
export async function loadTimelineFromDrive(directory: string): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("Cannot load Timeline while offline");
  }
  await migratePendingFiles();
  const response = await fetch("/api/drive/files?action=list", { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to list Timeline files on Drive");
  const data = await response.json() as { files: RemoteFile[]; meta?: RemoteMetaResponse };
  const prefix = `${directory.replace(/\/+$/, "")}/`;
  const files = data.files.filter((file) => file.name.startsWith(prefix) && file.name.toLowerCase().endsWith(".md"));
  for (const file of files) {
    const remote = await readRemote(file);
    await applyRemoteFile({ ...file, md5Checksum: remote.md5Checksum }, remote.content, data.meta, false);
  }
  if (data.meta) {
    const cachedRemote = await getCachedRemoteMeta();
    if (cachedRemote) {
      const pending = Object.fromEntries(
        Object.entries(cachedRemote.files).filter(([fileId]) => fileId.startsWith("new:")),
      );
      await setCachedRemoteMeta({
        ...cachedRemote,
        lastUpdatedAt: data.meta.lastUpdatedAt,
        files: { ...data.meta.files, ...pending },
        cachedAt: Date.now(),
      });
    }
  }
  window.dispatchEvent(new Event("sync-complete"));
}
