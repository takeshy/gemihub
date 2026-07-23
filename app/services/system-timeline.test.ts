import assert from "node:assert/strict";
import test from "node:test";
import { parseMemoFile } from "~/dashboard/memo/memoTimeline";
import {
  buildTimelineEntry,
  isDateKey,
  localDateKey,
  systemTimelinePath,
  TIMELINE_AI_INSTRUCTION,
  TIMELINE_TOOL_DEFINITIONS,
} from "./system-timeline";
import { canPushTimelineUpdate } from "./timeline-drive";

test("system timeline uses the local calendar date and canonical path", () => {
    const date = new Date(2026, 6, 23, 23, 30);
    assert.equal(localDateKey(date), "2026-07-23");
    assert.equal(systemTimelinePath("2026-07-23"), "Dashboards/Timeline/Timeline/2026-07-23.md");
});

test("system timeline rejects impossible date keys", () => {
    assert.equal(isDateKey("2026-07-23"), true);
    assert.equal(isDateKey("2026-02-30"), false);
    assert.equal(isDateKey("July 23"), false);
});

test("system timeline appends entries without replacing activity", () => {
    const first = buildTimelineEntry("", "最初の活動", new Date("2026-07-23T01:02:03.004Z"));
    const second = buildTimelineEntry(first, "次の活動", new Date("2026-07-23T02:03:04.005Z"));
    const parsed = parseMemoFile(second);
    assert.equal(parsed.source, "timeline:Timeline");
    assert.deepEqual(parsed.entries.map((entry) => entry.body), ["最初の活動", "次の活動"]);
});

test("system timeline exposes AI read and append tools", () => {
    assert.deepEqual(TIMELINE_TOOL_DEFINITIONS.map((tool) => tool.name), ["read_timeline", "append_timeline"]);
    assert.match(TIMELINE_AI_INSTRUCTION, /call read_timeline before answering/);
});

test("realtime Timeline Push only updates an unchanged remote base", () => {
  assert.equal(canPushTimelineUpdate("same", "same"), true);
  assert.equal(canPushTimelineUpdate("local base", "remote changed"), false);
});
