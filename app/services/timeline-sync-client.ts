import { withTimelineFileLock } from "./timeline-local-lock";
import { activeProjectMountKey, getCachedRemoteMeta, getCachedFile, getEditHistoryForFile, applyTimelineSnapshotCAS } from "./indexeddb-cache";
import { findFileByNameLocal } from "./drive-local";
import { flushTimelinePushes } from "./timeline-drive";
import { parseMemoFile } from "~/dashboard/memo/memoTimeline";
import { parseTimeline, serializeTimeline } from "./timeline-format";
import { mergeTimelineSnapshots } from "./timeline-snapshot-merge";
import type { KakerattaSettings } from "~/types/kakeratta";

interface FileSnapshot { name: string; content: string }
interface SyncedFile extends FileSnapshot { file: { id: string; md5Checksum?: string; modifiedTime?: string } }
export interface BrowserTimelineSyncInput { timelineFiles: FileSnapshot[]; timelineRootFolderId?: string; localBefore?: FileSnapshot[] }

export async function browserTimelineInput(config?: KakerattaSettings): Promise<BrowserTimelineSyncInput> {
  if (!config?.timelineSync?.enabled || activeProjectMountKey()) return { timelineFiles: [] };
  await flushTimelinePushes();
  const meta = await getCachedRemoteMeta();
  if (!meta) return { timelineFiles: [] };
  const directory = `Dashboards/Timeline/${config.timelineSync.name.trim().replace(/\s+/g, "-")}`;
  const reads = await Promise.allSettled(Object.entries(meta.files).filter(([, file]) => file.name.startsWith(`${directory}/`) && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.name.slice(directory.length + 1)))
    .map(async ([id, file]) => withTimelineFileLock(file.name, async () => {
      const cached = await getCachedFile(id);
      const history = await getEditHistoryForFile(id);
      const dirty = id.startsWith("new:") || !!history?.diffs.some(diff => diff.diff.trim());
      if (!cached) {
        if (dirty) throw new Error("An edited Timeline file is not cached. Reload before synchronizing.");
        return null;
      }
      return { snapshot: { name: file.name, content: cached.content }, dirty };
    })));
  const files: FileSnapshot[] = [];
  const localBefore: FileSnapshot[] = [];
  for (const read of reads) {
    if (read.status === "rejected") throw read.reason;
    if (!read.value) continue;
    localBefore.push(read.value.snapshot);
    if (read.value.dirty) files.push(read.value.snapshot);
  }
  return { timelineFiles: files, localBefore, timelineRootFolderId: meta.rootFolderId };
}

/** A response may arrive after another post/edit. Merge and atomically compare. */
export async function applyBrowserTimelineResult(
  value: unknown,
  before: BrowserTimelineSyncInput,
): Promise<void> {
  if (!value || typeof value !== "object" || activeProjectMountKey()) return;
  const result = value as { files?: SyncedFile[]; connection?: string; rootFolderId?: string };
  if (!Array.isArray(result.files) || !result.connection || !result.rootFolderId) return;
  const connection = result.connection;
  const rootFolderId = result.rootFolderId;
  const meta = await getCachedRemoteMeta();
  if (meta && meta.rootFolderId !== rootFolderId) return;
  await flushTimelinePushes();
  for (const remote of result.files) {
    await withTimelineFileLock(remote.name, async () => {
      const base = (before.localBefore ?? before.timelineFiles).find(file => file.name === remote.name)?.content ?? "";
      let applied = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const local = await findFileByNameLocal(remote.name);
        const current = local ? await getCachedFile(local.id) : undefined;
        const merged = await mergeTimelineSnapshots(parseTimeline(current?.content ?? "", remote.name), parseTimeline(remote.content, remote.name), parseTimeline(base, remote.name), connection);
        const content = serializeTimeline(merged, parseMemoFile(remote.content).source);
        applied = await applyTimelineSnapshotCAS({
          expectedFileId: current?.fileId,
          expectedContent: current?.content,
          rootFolderId,
          remoteContent: remote.content,
          file: { fileId: remote.file.id, fileName: remote.name, content, md5Checksum: remote.file.md5Checksum ?? "", modifiedTime: remote.file.modifiedTime ?? new Date().toISOString(), cachedAt: Date.now() },
        });
        if (applied) break;
      }
      if (!applied) throw new Error("Timeline is being edited; synchronization will retry");
    });
  }
  window.dispatchEvent(new Event("sync-complete"));
  window.dispatchEvent(new Event("dashboard-data-changed"));
}
