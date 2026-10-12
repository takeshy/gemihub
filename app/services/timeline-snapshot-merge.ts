import type { TimelineEntry } from "./timeline-format";
import { mergeTimelineEntry, timelineVersion } from "./timeline-merge";
import { timelineFingerprint } from "./kakeratta-timeline";

/** Resolve Drive/offline races by entry, preserving a conflicting local version. */
export async function mergeTimelineSnapshots(
  current: TimelineEntry[], desired: TimelineEntry[], base: TimelineEntry[], connection: string,
): Promise<TimelineEntry[]> {
  const target = new Map(desired.map(entry => [entry.id, entry]));
  const previous = new Map(base.map(entry => [entry.id, entry]));
  const output: TimelineEntry[] = [];
  for (const local of current) {
    const remote = target.get(local.id);
    if (!remote) { output.push(local); continue; }
    const original = previous.get(local.id);
    const conflictId = `conflict_${(await timelineFingerprint(`${connection}\n${local.id}\n${JSON.stringify(timelineVersion(local))}`)).slice(0, 48)}`;
    const result = mergeTimelineEntry(local, remote, original ? timelineVersion(original) : null, conflictId);
    output.push(result.entry);
    if (result.conflict && !target.has(result.conflict.id) && !current.some(entry => entry.id === result.conflict!.id)) output.push(result.conflict);
    target.delete(local.id);
  }
  output.push(...target.values());
  return output;
}
