import {
  applyPushedFileMetadata,
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

interface TimelinePushJob {
  name: string;
  baseContent: string;
  nextContent: string;
}

const timelinePushQueues = new Map<string, Promise<void>>();

/**
 * Apply the metadata returned by a background Timeline push without replacing
 * the locally rendered content. A newer local edit may already exist by the
 * time Drive responds; only clear its dirty marker when the pushed snapshot is
 * still the latest one.
 */
async function applyTimelinePushResult(
  file: RemoteFile,
  pushedContent: string,
  meta?: RemoteMetaResponse,
): Promise<void> {
  const local = await findFileByNameLocal(file.name);
  const modifiedTime = file.modifiedTime ?? new Date().toISOString();

  if (local) {
    await applyPushedFileMetadata(local.id, pushedContent, {
      md5Checksum: file.md5Checksum ?? "",
      modifiedTime,
    });
  }

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
    const entry = meta?.files[file.id];
    localMeta.files[file.id] = {
      md5Checksum: entry?.md5Checksum ?? file.md5Checksum ?? "",
      modifiedTime: entry?.modifiedTime ?? modifiedTime,
      name: entry?.name ?? file.name,
      size: entry?.size ?? file.size,
    };
    localMeta.lastUpdatedAt = meta?.lastUpdatedAt ?? localMeta.lastUpdatedAt;
    await setLocalSyncMeta(localMeta);
  }
  window.dispatchEvent(new Event("sync-complete"));
}

export function canPushTimelineUpdate(baseContent: string, remoteContent: string): boolean {
  return baseContent === remoteContent;
}

async function pushTimelineUpdate(job: TimelinePushJob): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  // New daily files are created by the existing pending-file migration. It is
  // already local-first and uploads only that file, so join it before deciding
  // whether an additional update is necessary.
  await migratePendingFiles();
  const remote = await findRemoteByName(job.name);
  const snapshot = remote ? await readRemote(remote) : { content: "", md5Checksum: "" };

  // A migration or an earlier queued job may already have uploaded this exact
  // snapshot. Nothing else needs to be pushed.
  if (snapshot.content === job.nextContent) {
    if (remote) {
      await applyTimelinePushResult(
        { ...remote, md5Checksum: snapshot.md5Checksum || remote.md5Checksum },
        job.nextContent,
      );
    }
    return;
  }

  // Never fold a remote change into the local cache during realtime Push.
  // Leave the local edit dirty so the normal conflict-aware Push/Pull flow can
  // resolve it explicitly.
  if (!canPushTimelineUpdate(job.baseContent, snapshot.content)) {
    window.dispatchEvent(new CustomEvent("timeline-push-conflict", { detail: { path: job.name } }));
    return;
  }

  const response = await fetch("/api/drive/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "upsertChecked",
      name: job.name,
      content: job.nextContent,
      mimeType: "text/markdown",
      expectedFileId: remote?.id,
      expectedMd5Checksum: snapshot.md5Checksum,
    }),
  });
  if (response.status === 409) {
    window.dispatchEvent(new CustomEvent("timeline-push-conflict", { detail: { path: job.name } }));
    return;
  }
  if (!response.ok) throw new Error("Failed to update Timeline file on Drive");
  const data = await response.json() as { file: RemoteFile; meta?: RemoteMetaResponse };
  await applyTimelinePushResult(data.file, job.nextContent, data.meta);
}

function scheduleTimelinePush(job: TimelinePushJob): void {
  const previous = timelinePushQueues.get(job.name) ?? Promise.resolve();
  const queued = previous
    .catch(() => {})
    .then(() => pushTimelineUpdate(job))
    .catch((error) => {
      console.error("Timeline realtime Push failed", error);
      window.dispatchEvent(new CustomEvent("timeline-push-error", { detail: { path: job.name } }));
    });
  timelinePushQueues.set(job.name, queued);
  void queued.finally(() => {
    if (timelinePushQueues.get(job.name) === queued) timelinePushQueues.delete(job.name);
  });
}

/**
 * Update Timeline locally and return immediately after IndexedDB is current.
 * The matching Drive file is pushed in a per-file background queue; no Pull or
 * workspace-wide Push is started here.
 */
export async function mutateTimelineFile(
  name: string,
  mutate: (current: string) => string | null,
): Promise<string> {
  const local = await findFileByNameLocal(name);
  const current = local ? await readFileLocal(local.id) : "";
  const next = mutate(current);
  if (next == null) throw new Error("Timeline entry no longer exists");
  await writeFileLocal(name, next, local ? { existingFileId: local.id } : undefined);
  if (typeof navigator === "undefined" || navigator.onLine) {
    scheduleTimelinePush({ name, baseContent: current, nextContent: next });
  }
  return next;
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
