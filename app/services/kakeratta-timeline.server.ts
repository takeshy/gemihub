import { FieldValue } from "@google-cloud/firestore";
import { createFile, findFilesByExactName, getFileMetadata, listFiles, readFile, type DriveFile } from "./google-drive.server";
import { getOwnedPersonalAccount } from "./personal-hubwork-account.server";
import { tryAcquireScheduleLock, updateScheduleRuntime } from "./hubwork-accounts.server";
import { isActivePremiumAccount } from "~/types/hubwork";
import { upsertFilesInMeta } from "./sync-meta.server";
import { withKakeratta } from "./kakeratta.server";
import { parseTimeline, serializeTimeline, type TimelineEntry } from "./timeline-format";
import { mergeTimelineSnapshots } from "./timeline-snapshot-merge";
import { syncKakerattaTimeline, timelineFingerprint, type TimelineSyncCursor } from "./kakeratta-timeline";
import type { KakerattaSettings } from "~/types/kakeratta";
import type { SessionTokens } from "./session.server";

export class TimelinePremiumRequired extends Error {}
export async function requireTimelinePremium(
  tokens: Pick<SessionTokens, "email" | "rootFolderId">,
  resolve = getOwnedPersonalAccount,
) {
  const account = await resolve(tokens);
  if (!account || !isActivePremiumAccount(account)) throw new TimelinePremiumRequired("Timeline synchronization requires your own active Premium plan");
  return account;
}

export interface TimelineFileSnapshot { name: string; content: string }
export interface DriveSnapshot extends TimelineFileSnapshot { file: DriveFile; etag: string }

function timelineDirectory(name: string): string {
  return `Dashboards/Timeline/${name.trim().replace(/\s+/g, "-")}`;
}

/** The v2 metadata ETag and If-Match guard the actual content write. */
export async function readTimelineDriveSnapshot(accessToken: string, file: DriveFile, signal: AbortSignal, readContent = readFile): Promise<DriveSnapshot> {
  const metadata = async () => {
    const response = await fetch(`https://www.googleapis.com/drive/v2/files/${encodeURIComponent(file.id)}?fields=etag,md5Checksum`, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
    if (!response.ok) throw new Error("Cannot inspect Timeline file version");
    const value = await response.json() as { etag?: string; md5Checksum?: string };
    if (typeof value.etag !== "string" || !value.etag) throw new Error("Timeline file has no conditional-write version");
    return value;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await metadata();
    const content = await readContent(accessToken, file.id);
    const after = await metadata();
    if (before.etag === after.etag) return { file: { ...file, md5Checksum: after.md5Checksum }, name: file.name, content, etag: after.etag! };
  }
  throw new Error("Timeline file changed repeatedly while reading");
}

export async function writeTimelineDriveSnapshot(accessToken: string, snapshot: DriveSnapshot, content: string, signal: AbortSignal, resolveMetadata = getFileMetadata): Promise<DriveFile | null> {
  const response = await fetch(`https://www.googleapis.com/upload/drive/v2/files/${encodeURIComponent(snapshot.file.id)}?uploadType=media`, {
    method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "If-Match": snapshot.etag, "Content-Type": snapshot.file.mimeType || "text/markdown" }, body: content, signal,
  });
  if (response.status === 412) return null;
  if (!response.ok) throw new Error("Cannot save synchronized Timeline");
  return resolveMetadata(accessToken, snapshot.file.id);
}

export async function syncTimelineFromDrive(
  tokens: Pick<SessionTokens, "accessToken" | "email" | "rootFolderId">,
  config: KakerattaSettings,
  language: string,
  signal: AbortSignal,
  localFiles: TimelineFileSnapshot[] = [],
) {
  if (!config.enabled || !config.timelineSync.enabled) return { disabled: true, files: [], conflicts: 0, pending: 0 };
  const account = await requireTimelinePremium(tokens);
  const directory = timelineDirectory(config.timelineSync.name);
  const matchesDay = (name: string) => name.startsWith(`${directory}/`) && /^\d{4}-\d{2}-\d{2}\.md$/.test(name.slice(directory.length + 1));
  if (localFiles.length > 2000 || localFiles.some(file => typeof file.name !== "string" || typeof file.content !== "string" || !matchesDay(file.name)) || localFiles.reduce((size, file) => size + file.content.length, 0) > 20_000_000) throw new Error("Invalid local Timeline files");
  const scheduleId = "__kakeratta_timeline";
  if (!await tryAcquireScheduleLock({ accountId: account.id, scheduleId, timeoutSec: 600, policy: "forbid" })) return { busy: true, files: [], conflicts: 0, pending: 0 };
  try {
    const connection = await timelineFingerprint(JSON.stringify([tokens.rootFolderId, config.url, Object.entries(config.headers).map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a.localeCompare(b))]));
    const files = await listFiles(tokens.accessToken, tokens.rootFolderId);
    const stateName = `${directory}/_kakeratta-sync.json`;
    const selected = files.filter(file => matchesDay(file.name) || file.name === stateName);
    const names = new Set<string>();
    for (const file of selected) {
      if (names.has(file.name)) throw new Error("Duplicate Timeline files must be resolved before synchronizing");
      names.add(file.name);
    }
    const snapshots: DriveSnapshot[] = [];
    for (let offset = 0; offset < selected.length; offset += 8) {
      signal.throwIfAborted();
      const reads = await Promise.allSettled(selected.slice(offset, offset + 8).map(file => readTimelineDriveSnapshot(tokens.accessToken, file, signal)));
      for (const read of reads) {
        if (read.status === "rejected") throw read.reason;
        snapshots.push(read.value);
      }
    }
    const state = snapshots.find(file => file.name === stateName);
    let cursor: TimelineSyncCursor | undefined;
    if (state) { try { cursor = JSON.parse(state.content) as TimelineSyncCursor; } catch { /* Backfill again; IDs remain stable. */ } }
    const originals = snapshots.filter(file => matchesDay(file.name)).flatMap(file => parseTimeline(file.content, file.name));
    const browserEntries = localFiles.flatMap(file => parseTimeline(file.content, file.name));
    // An acknowledged Kakeratta base is also the common ancestor for an offline
    // edit and a newer Drive version. Without ancestry, preserve both versions.
    const bases = browserEntries.flatMap(entry => {
      try {
        const base = JSON.parse(entry.metadata["kakeratta-base"] ?? "null");
        return base && typeof base.content === "string" && typeof base.deleted === "boolean" ? [{ ...entry, content: base.content, deleted: base.deleted }] : [];
      } catch { return []; }
    });
    const combined = browserEntries.length ? await mergeTimelineSnapshots(browserEntries, originals, bases, connection) : originals;
    const result = await withKakeratta(config, signal, call => syncKakerattaTimeline({ entries: combined, call, connection, directory, enabledAt: config.timelineSync.enabledAt, language, cursor, signal }));
    const byPath = new Map<string, TimelineEntry[]>();
    for (const entry of result.entries) {
      const group = byPath.get(entry.sourcePath) ?? [];
      group.push(entry); byPath.set(entry.sourcePath, group);
    }
    const saved: { file: DriveFile; name: string; content: string }[] = [];
    const save = async (name: string, desired: string, original?: DriveSnapshot) => {
      signal.throwIfAborted();
      if (!original) {
        const existing = await findFilesByExactName(tokens.accessToken, name, tokens.rootFolderId);
        if (existing.length > 1) throw new Error("Duplicate Timeline files");
        if (existing[0]) original = await readTimelineDriveSnapshot(tokens.accessToken, existing[0], signal);
        else {
          const file = await createFile(tokens.accessToken, name, desired, tokens.rootFolderId, name.endsWith(".json") ? "application/json" : "text/markdown");
          saved.push({ file, name, content: desired }); return;
        }
      }
      let snapshot = original;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (snapshot.content === desired) { saved.push({ file: snapshot.file, name, content: desired }); return; }
        const file = await writeTimelineDriveSnapshot(tokens.accessToken, snapshot, desired, signal);
        if (file) { saved.push({ file, name, content: desired }); return; }
        const current = await readTimelineDriveSnapshot(tokens.accessToken, snapshot.file, signal);
        if (name.endsWith(".json")) throw new Error("Timeline sync cursor changed concurrently");
        const merged = await mergeTimelineSnapshots(parseTimeline(current.content, name), parseTimeline(desired, name), parseTimeline(original.content, name), connection);
        desired = serializeTimeline(merged, `timeline:${config.timelineSync.name}`);
        snapshot = current;
      }
      throw new Error("Timeline changed repeatedly while synchronizing");
    };
    for (const [name, entries] of byPath) await save(name, serializeTimeline(entries, `timeline:${config.timelineSync.name}`), snapshots.find(file => file.name === name));
    // The cursor follows durable entry writes. Lost responses can replay safely.
    await save(stateName, JSON.stringify(result.cursor), state);
    await upsertFilesInMeta(tokens.accessToken, tokens.rootFolderId, saved.map(({ file }) => file));
    return { rootFolderId: tokens.rootFolderId, connection, files: saved.filter(file => matchesDay(file.name)), conflicts: result.conflicts, pending: result.pending, backfillPending: !result.cursor.complete };
  } finally {
    await updateScheduleRuntime(account.id, scheduleId, { lockedUntil: FieldValue.delete() });
  }
}
