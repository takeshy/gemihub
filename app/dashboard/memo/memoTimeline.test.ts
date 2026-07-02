import assert from "node:assert/strict";
import test from "node:test";
import {
  appendEntryBlock,
  buildEntryBlock,
  deleteEntry,
  parseMemoFile,
  replaceEntryBody,
  setEntryPinned,
  summarizeMemoContent,
  uniqueEntryId,
} from "./memoTimeline.ts";

const SOURCE = "/Users/takeshy/books/go_book.pdf";

function fileWithEntries(): string {
  let content = "";
  content = appendEntryBlock(content, SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T10:15:00.000Z",
    id: "20260702-191500-000",
    anchor: "page=12",
    quotePrefix: "直前の文脈",
    quoteSuffix: "直後の文脈",
    quote: "ハイライトした引用文",
    body: "メモ本文です",
  }));
  content = appendEntryBlock(content, SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T11:00:00.000Z",
    id: "20260702-200000-000",
    body: "アンカーなしの通常メモ",
  }));
  return content;
}

test("frontmatter is not parsed as an entry", () => {
  const { source, entries } = parseMemoFile(fileWithEntries());
  assert.deepEqual(source, SOURCE);
  assert.deepEqual(entries.length, 2);
  assert.deepEqual(entries.every((entry) => !entry.body.includes("source:")), true);
});

test("round-trips anchored entry fields", () => {
  const { entries } = parseMemoFile(fileWithEntries());
  const [anchored, plain] = entries;
  assert.deepEqual(anchored.id, "20260702-191500-000");
  assert.deepEqual(anchored.createdAt, "2026-07-02T10:15:00.000Z");
  assert.deepEqual(anchored.anchor, "page=12");
  assert.deepEqual(anchored.quotePrefix, "直前の文脈");
  assert.deepEqual(anchored.quoteSuffix, "直後の文脈");
  assert.deepEqual(anchored.quote, "ハイライトした引用文");
  assert.deepEqual(anchored.body, "メモ本文です");
  assert.deepEqual(plain.anchor, null);
  assert.deepEqual(plain.body, "アンカーなしの通常メモ");
});

test("code block containing --- does not split an entry", () => {
  const body = "コード:\n\n```yaml\n---\nkey: value\n---\n```\n\n終わり";
  const content = appendEntryBlock("", SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T10:15:00.000Z",
    id: "20260702-191500-000",
    body,
  }));
  const { entries } = parseMemoFile(content);
  assert.deepEqual(entries.length, 1);
  assert.deepEqual(entries[0].body.includes("```yaml"), true);
});

test("leading blockquote without anchor stays in the body", () => {
  const content = appendEntryBlock("", SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T10:15:00.000Z",
    id: "20260702-191500-000",
    body: "> ただの引用スタイルの本文\n\n続き",
  }));
  const { entries } = parseMemoFile(content);
  assert.deepEqual(entries[0].quote, "");
  assert.deepEqual(entries[0].body.startsWith(">"), true);
});

test("malformed blocks degrade to body-only entries", () => {
  const content = `---\nsource: ${SOURCE}\n---\n\nただのテキスト\n\n---\n\n2026-07-02T10:15:00.000Z\nid: 20260702-191500-000\n\n正常なエントリ\n`;
  const { entries } = parseMemoFile(content);
  assert.deepEqual(entries.length, 2);
  assert.deepEqual(entries[0].parsed, false);
  assert.deepEqual(entries[0].body, "ただのテキスト");
  assert.deepEqual(entries[1].parsed, true);
});

test("multiline quotes round-trip via blockquote lines", () => {
  const content = appendEntryBlock("", SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T10:15:00.000Z",
    id: "20260702-191500-000",
    anchor: "text",
    quote: "1行目\n2行目",
    body: "本文",
  }));
  const { entries } = parseMemoFile(content);
  assert.deepEqual(entries[0].quote, "1行目\n2行目");
  assert.deepEqual(entries[0].body, "本文");
});

test("quote prefix/suffix values are normalized to a single line", () => {
  const block = buildEntryBlock({
    createdAt: "2026-07-02T10:15:00.000Z",
    id: "20260702-191500-000",
    anchor: "text",
    quotePrefix: "改行\nを含む  値",
    quote: "引用",
  });
  assert.deepEqual(block.includes("quote-prefix: 改行 を含む 値"), true);
});

test("unique id gets suffixed on collision", () => {
  const content = fileWithEntries();
  const date = new Date(2026, 6, 2, 19, 15, 0, 0); // local 19:15:00.000
  assert.deepEqual(uniqueEntryId(content, date), "20260702-191500-000-2");
  assert.deepEqual(uniqueEntryId("", date), "20260702-191500-000");
});

test("replaceEntryBody rewrites only the target entry", () => {
  const next = replaceEntryBody(fileWithEntries(), "20260702-200000-000", "編集後の本文");
  if (!next) throw new Error("entry not found");
  const { entries } = parseMemoFile(next);
  assert.deepEqual(entries[1].body, "編集後の本文");
  assert.deepEqual(entries[0].body, "メモ本文です");
  assert.deepEqual(entries[0].anchor, "page=12");
  assert.deepEqual(replaceEntryBody(fileWithEntries(), "missing", "x"), null);
});

test("setEntryPinned toggles and survives round-trip", () => {
  const pinned = setEntryPinned(fileWithEntries(), "20260702-191500-000", true);
  if (!pinned) throw new Error("entry not found");
  assert.deepEqual(parseMemoFile(pinned).entries[0].pinned, true);
  const unpinned = setEntryPinned(pinned, "20260702-191500-000", false);
  if (!unpinned) throw new Error("entry not found");
  assert.deepEqual(parseMemoFile(unpinned).entries[0].pinned, false);
});

test("deleteEntry removes the target and keeps frontmatter", () => {
  const next = deleteEntry(fileWithEntries(), "20260702-191500-000");
  if (!next) throw new Error("entry not found");
  const { source, entries } = parseMemoFile(next);
  assert.deepEqual(source, SOURCE);
  assert.deepEqual(entries.length, 1);
  assert.deepEqual(entries[0].id, "20260702-200000-000");
  assert.deepEqual(deleteEntry(next, "missing"), null);
});

test("summarizeMemoContent reports count and newest entry text", () => {
  const content = appendEntryBlock(fileWithEntries(), SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T12:00:00.000Z",
    id: "20260702-210000-000",
    body: "読了",
  }));
  assert.deepEqual(summarizeMemoContent(content), { count: 3, lastText: "読了" });
});

test("summarizeMemoContent truncates and collapses newlines", () => {
  const content = appendEntryBlock("", SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T12:00:00.000Z",
    id: "20260702-210000-000",
    body: "一二三四五\n六七八九十拾壱",
  }));
  assert.deepEqual(summarizeMemoContent(content), { count: 1, lastText: "一二三四五 六七八九…" });
});

test("summarizeMemoContent falls back to the quote and handles empty files", () => {
  const content = appendEntryBlock("", SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T12:00:00.000Z",
    id: "20260702-210000-000",
    anchor: "page=3",
    quote: "引用だけのメモ",
  }));
  assert.deepEqual(summarizeMemoContent(content), { count: 1, lastText: "引用だけのメモ" });
  assert.deepEqual(summarizeMemoContent(""), { count: 0, lastText: "" });
});

test("append preserves existing bytes and file stays parseable", () => {
  const first = fileWithEntries();
  const appended = appendEntryBlock(first, SOURCE, buildEntryBlock({
    createdAt: "2026-07-02T12:00:00.000Z",
    id: "20260702-210000-000",
    body: "3件目",
  }));
  assert.deepEqual(appended.startsWith(first.trimEnd()), true);
  assert.deepEqual(parseMemoFile(appended).entries.length, 3);
});
