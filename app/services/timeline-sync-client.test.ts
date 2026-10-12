import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { setCachedFile, setCachedRemoteMeta, setEditHistoryEntry } from "./indexeddb-cache-drive.ts";
import { browserTimelineInput } from "./timeline-sync-client.ts";
import { KakerattaSettingsSchema } from "~/types/kakeratta";

test("only dirty days are uploaded, while clean snapshots remain available for a late-response merge", async () => {
  const modifiedTime = "2026-10-12T00:00:00.000Z";
  const names = ["Dashboards/Timeline/Timeline/2026-10-11.md", "Dashboards/Timeline/Timeline/2026-10-12.md"];
  for (const [index, name] of names.entries()) await setCachedFile({ fileId: `day-${index}`, fileName: name, content: `content-${index}`, md5Checksum: "cached", modifiedTime, cachedAt: 1 });
  await setCachedRemoteMeta({ id: "current", rootFolderId: "root", lastUpdatedAt: "", cachedAt: 1, files: Object.fromEntries(names.map((name, index) => [`day-${index}`, { name, mimeType: "text/markdown", md5Checksum: "cached", modifiedTime }])) });
  await setEditHistoryEntry({ fileId: "day-1", filePath: names[1], diffs: [{ diff: "+edit", timestamp: modifiedTime, stats: { additions: 1, deletions: 0 } }] });
  const input = await browserTimelineInput(KakerattaSettingsSchema.parse({ enabled: true, timelineSync: { enabled: true } }));
  assert.deepEqual(input.timelineFiles.map(file => file.name), [names[1]]);
  assert.equal(input.localBefore?.length, 2);
  assert.equal(input.timelineRootFolderId, "root");
});
