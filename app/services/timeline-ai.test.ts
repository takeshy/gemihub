import assert from "node:assert/strict";
import test from "node:test";
import { buildEntryBlock } from "../dashboard/memo/memoTimeline.ts";
import { parseTimeline } from "./timeline-format.ts";
import { buildTimelineAiPrompt, hasAiMention, isTimelineAiLookupActive, parseTimelineAiSettings } from "./timeline-ai.ts";

test("only a standalone @ai mention asks the AI", () => {
  for (const text of ["@ai what is this?", "hello @AI", "(@ai)", "教えて@ai", "@ai、要約して", "@aiに聞く"]) assert.equal(hasAiMention(text), true, text);
  for (const text of ["me@ai.example", "@aid", "@ai-bot", "@ai_x", "@@ai", "said", "x.@ai"]) assert.equal(hasAiMention(text), false, text);
});

test("settings fall back to defaults for missing or malformed values", () => {
  assert.deepEqual(parseTimelineAiSettings(null), { model: "", driveRead: false, search: "", mcpServers: [], skills: [] });
  assert.deepEqual(parseTimelineAiSettings("{"), { model: "", driveRead: false, search: "", mcpServers: [], skills: [] });
  const parsed = parseTimelineAiSettings(JSON.stringify({ model: "m", driveRead: true, search: "rag:docs", mcpServers: ["a", 1], skills: "x" }));
  assert.deepEqual(parsed, { model: "m", driveRead: true, search: "rag:docs", mcpServers: ["a"], skills: [] });
  assert.equal(isTimelineAiLookupActive(parsed), true);
  assert.equal(isTimelineAiLookupActive(parseTimelineAiSettings(JSON.stringify({ model: "m" }))), false);
});

test("the prompt carries the thread and marks the post to answer", () => {
  const content = [
    buildEntryBlock({ id: "root", createdAt: "2026-10-12T10:00:00.000Z", metadata: { speaker: "user", "author-name": "Alice" }, body: "Plan the trip" }),
    buildEntryBlock({ id: "ai1", createdAt: "2026-10-12T10:01:00.000Z", metadata: { speaker: "ai", "author-name": "AI", "root-id": "root", "reply-to": "root" }, body: "Sure." }),
    buildEntryBlock({ id: "gone", createdAt: "2026-10-12T10:02:00.000Z", metadata: { speaker: "user", deleted: "true", "root-id": "root" }, body: "secret" }),
    buildEntryBlock({ id: "q", createdAt: "2026-10-12T10:03:00.000Z", metadata: { speaker: "user", "root-id": "root", "reply-to": "ai1" }, body: "@ai which day?" }),
  ].join("\n\n---\n\n");
  const posts = parseTimeline(content, "day.md");
  const prompt = buildTimelineAiPrompt(posts, posts[3]);
  assert.match(prompt, /Alice:\nPlan the trip/);
  assert.match(prompt, /\] AI:\nSure\./);
  assert.match(prompt, /User \(addressed to you\):\n@ai which day\?/);
  assert.doesNotMatch(prompt, /secret/);
  assert.match(prompt, /Reply to this post by User:\n\n@ai which day\?$/);
});
