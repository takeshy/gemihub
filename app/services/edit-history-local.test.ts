import assert from "node:assert/strict";
import test from "node:test";
import * as Diff from "diff";
import {
  reverseApplyDiff,
  reconstructContent,
  type DiffWithOrigin,
} from "./edit-history-local.ts";

// ── Helper ──────────────────────────────────────────────────────────────────
// Replicates the private createDiffStr used in production code.
function makeDiff(oldContent: string, newContent: string): string {
  const patch = Diff.structuredPatch(
    "original",
    "modified",
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: 3 }
  );
  const lines: string[] = [];
  for (const hunk of patch.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    );
    for (const line of hunk.lines) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// reverseApplyDiff
// ══════════════════════════════════════════════════════════════════════════════

test("reverseApplyDiff: undo a single line addition", () => {
  const old = "line1\nline2\n";
  const cur = "line1\nline2\nline3\n";
  const diff = makeDiff(old, cur);

  const result = reverseApplyDiff(cur, diff);
  assert.equal(result, old);
});

test("reverseApplyDiff: undo a single line deletion", () => {
  const old = "aaa\nbbb\nccc\n";
  const cur = "aaa\nccc\n";
  const diff = makeDiff(old, cur);

  const result = reverseApplyDiff(cur, diff);
  assert.equal(result, old);
});

test("reverseApplyDiff: undo a modification", () => {
  const old = "hello world\n";
  const cur = "hello universe\n";
  const diff = makeDiff(old, cur);

  const result = reverseApplyDiff(cur, diff);
  assert.equal(result, old);
});

test("reverseApplyDiff: undo multi-line changes", () => {
  const old = "a\nb\nc\nd\ne\n";
  const cur = "a\nB\nc\nD\ne\nf\n";
  const diff = makeDiff(old, cur);

  const result = reverseApplyDiff(cur, diff);
  assert.equal(result, old);
});

test("reverseApplyDiff: returns null on patch mismatch", () => {
  const diff = makeDiff("aaa\n", "bbb\n");
  // Apply to completely unrelated content
  const result = reverseApplyDiff("zzz\nyyy\n", diff);
  assert.equal(result, null);
});

// ══════════════════════════════════════════════════════════════════════════════
// reconstructContent — local diffs only
// ══════════════════════════════════════════════════════════════════════════════

test("reconstructContent: single local diff restores to base", () => {
  const base = "line1\nline2\n";
  const current = "line1\nline2\nline3\n";
  const diff = makeDiff(base, current);

  const diffs: DiffWithOrigin[] = [{ diff, origin: "local" }];
  const result = reconstructContent(current, diffs);
  assert.equal(result, base);
});

test("reconstructContent: two local diffs restore through chain", () => {
  // base → v1 → current
  const base = "alpha\n";
  const v1 = "alpha\nbeta\n";
  const current = "alpha\nbeta\ngamma\n";

  const diff_v1_to_current = makeDiff(v1, current);
  const diff_base_to_v1 = makeDiff(base, v1);

  // Ordered newest-first (the order allEntries provides via timestamp desc)
  const diffs: DiffWithOrigin[] = [
    { diff: diff_v1_to_current, origin: "local" },
    { diff: diff_base_to_v1, origin: "local" },
  ];

  // Restore to before diff[1] (base)
  const result = reconstructContent(current, diffs);
  assert.equal(result, base);
});

test("reconstructContent: restore to middle of local chain gives v1", () => {
  const _base = "alpha\n";
  const v1 = "alpha\nbeta\n";
  const current = "alpha\nbeta\ngamma\n";

  const diff_v1_to_current = makeDiff(v1, current);

  // Only apply the newest diff
  const diffs: DiffWithOrigin[] = [
    { diff: diff_v1_to_current, origin: "local" },
  ];

  const result = reconstructContent(current, diffs);
  assert.equal(result, v1);
});

// ══════════════════════════════════════════════════════════════════════════════
// reconstructContent — remote diffs only
// ══════════════════════════════════════════════════════════════════════════════

test("reconstructContent: remote diff skipped when content is at OLD side", () => {
  // Remote diff represents: old_drive → new_drive (push updated the file)
  // But locally the cache still has old_drive content (not yet pulled)
  const old_drive = "本当にいいお父さんですか？\n本当にいいお母さんですか？\n";
  const new_drive = "本当にいいお父さんですか？\n本当にいいお母さんですか？\naaaaaa\n";
  const remoteDiff = makeDiff(old_drive, new_drive);

  // Cache is at old_drive (the OLD side) — canApplyForward succeeds → skip
  const diffs: DiffWithOrigin[] = [{ diff: remoteDiff, origin: "remote" }];
  const result = reconstructContent(old_drive, diffs);
  assert.equal(result, old_drive);
});

test("reconstructContent: remote diff reverse-applied when content is at NEW side", () => {
  const old_drive = "line1\n";
  const new_drive = "line1\nline2\n";
  const remoteDiff = makeDiff(old_drive, new_drive);

  // Cache is at new_drive (the NEW side) — canApplyForward fails → reverse-apply
  const diffs: DiffWithOrigin[] = [{ diff: remoteDiff, origin: "remote" }];
  const result = reconstructContent(new_drive, diffs);
  assert.equal(result, old_drive);
});

test("reconstructContent: chain of remote diffs reverse-applied from NEW side", () => {
  // remote history: v0 → v1 → v2 (each push created a diff)
  // Cache has v2 (latest pulled)
  const v0 = "first\n";
  const v1 = "first\nsecond\n";
  const v2 = "first\nsecond\nthird\n";

  const remoteDiff_v0_to_v1 = makeDiff(v0, v1);
  const remoteDiff_v1_to_v2 = makeDiff(v1, v2);

  // allEntries is newest-first
  const diffs: DiffWithOrigin[] = [
    { diff: remoteDiff_v1_to_v2, origin: "remote" },
    { diff: remoteDiff_v0_to_v1, origin: "remote" },
  ];

  const result = reconstructContent(v2, diffs);
  assert.equal(result, v0);
});

// ══════════════════════════════════════════════════════════════════════════════
// reconstructContent — mixed local + remote (main scenario)
// ══════════════════════════════════════════════════════════════════════════════

test("reconstructContent: reverse-apply all diffs in chain", () => {
  // Timeline:
  //   remote push 1: v0 → v1  (diff stored on Drive)
  //   remote push 2: v1 → v2  (diff stored on Drive)
  //   pull v2 to local
  //   local edit session 1: v2 → v3  (local diff)
  //   local edit session 2: v3 → v4  (local diff)
  //
  // Cache now has v4.
  // allEntries (newest-first): local(v3→v4), local(v2→v3), remote(v1→v2), remote(v0→v1)

  const v0 = "line1\n";
  const v1 = "line1\nline2\n";
  const v2 = "line1\nline2\nline3\n";
  const v3 = "line1\nline2\nline3\nline4\n";
  const v4 = "line1\nline2\nline3\nline4\nline5\n";

  const remoteDiff_v0_v1 = makeDiff(v0, v1);
  const remoteDiff_v1_v2 = makeDiff(v1, v2);
  const localDiff_v2_v3 = makeDiff(v2, v3);
  const localDiff_v3_v4 = makeDiff(v3, v4);

  // Reverse all 4 diffs → v0
  const allDiffs: DiffWithOrigin[] = [
    { diff: localDiff_v3_v4, origin: "local" },
    { diff: localDiff_v2_v3, origin: "local" },
    { diff: remoteDiff_v1_v2, origin: "remote" },
    { diff: remoteDiff_v0_v1, origin: "remote" },
  ];

  const result = reconstructContent(v4, allDiffs);
  assert.equal(result, v0);
});

test("reconstructContent: UI restore — click on remote push 1, get state AT that entry (v1)", () => {
  // Same timeline. UI uses slice(0, targetIdx) to exclude the target entry.
  // Clicking on remote push 1 (v0→v1) at index 3:
  //   diffsToApply = allEntries.slice(0, 3) = [local(v3→v4), local(v2→v3), remote(v1→v2)]
  //   Result: v2 (state AT remote push 1 = state after v0→v1 was applied... wait, no)
  // Actually: reverse local(v3→v4), local(v2→v3), remote(v1→v2) → v1
  //   v1 is the state AT remote push 1 (after the v0→v1 change was applied)

  const _v0 = "line1\n"; // base state (unused in this test, but kept for readability)
  const v1 = "line1\nline2\n";
  const v2 = "line1\nline2\nline3\n";
  const v3 = "line1\nline2\nline3\nline4\n";
  const v4 = "line1\nline2\nline3\nline4\nline5\n";

  const remoteDiff_v1_v2 = makeDiff(v1, v2);
  const localDiff_v2_v3 = makeDiff(v2, v3);
  const localDiff_v3_v4 = makeDiff(v3, v4);

  // slice(0, 3) — exclude target at index 3
  const diffs: DiffWithOrigin[] = [
    { diff: localDiff_v3_v4, origin: "local" },
    { diff: localDiff_v2_v3, origin: "local" },
    { diff: remoteDiff_v1_v2, origin: "remote" },
  ];

  const result = reconstructContent(v4, diffs);
  assert.equal(result, v1);
});

test("reconstructContent: UI restore — click on remote push 2, get state AT that entry (v2)", () => {
  // Clicking on remote push 2 (v1→v2) at index 2:
  //   diffsToApply = allEntries.slice(0, 2) = [local(v3→v4), local(v2→v3)]
  //   reverse both locals → v2 (state AT remote push 2)

  const v2 = "line1\nline2\nline3\n";
  const v3 = "line1\nline2\nline3\nline4\n";
  const v4 = "line1\nline2\nline3\nline4\nline5\n";

  const localDiff_v2_v3 = makeDiff(v2, v3);
  const localDiff_v3_v4 = makeDiff(v3, v4);

  // slice(0, 2) — exclude target at index 2
  const diffs: DiffWithOrigin[] = [
    { diff: localDiff_v3_v4, origin: "local" },
    { diff: localDiff_v2_v3, origin: "local" },
  ];

  const result = reconstructContent(v4, diffs);
  assert.equal(result, v2);
});

test("reconstructContent: UI restore — click on local session 1, get state AT that entry (v3)", () => {
  // Clicking on local session 1 (v2→v3) at index 1:
  //   diffsToApply = allEntries.slice(0, 1) = [local(v3→v4)]
  //   reverse one local → v3

  const v3 = "line1\nline2\nline3\nline4\n";
  const v4 = "line1\nline2\nline3\nline4\nline5\n";

  const localDiff_v3_v4 = makeDiff(v3, v4);

  const diffs: DiffWithOrigin[] = [
    { diff: localDiff_v3_v4, origin: "local" },
  ];

  const result = reconstructContent(v4, diffs);
  assert.equal(result, v3);
});

test("reconstructContent: UI restore — click on newest entry is no-op", () => {
  // Clicking on the newest entry at index 0:
  //   diffsToApply = allEntries.slice(0, 0) = []
  //   No diffs to reverse → returns current content unchanged
  const v4 = "line1\nline2\nline3\nline4\nline5\n";

  const result = reconstructContent(v4, []);
  assert.equal(result, v4);
});

test("reconstructContent: remote diff skipped when local hasn't pulled yet", () => {
  // Scenario: user pushes v0→v1, then edits locally v0→v0_edit without pulling v1.
  // Cache has v0_edit.
  // allEntries: local(v0→v0_edit), remote(v0→v1)
  //
  // Restore to remote(v0→v1):
  //   1. reverse-apply local(v0→v0_edit) on v0_edit → v0
  //   2. remote(v0→v1): canApplyForward(v0, diff) → true (v0 is OLD side) → skip
  //   Result: v0

  const v0 = "original content\n";
  const v1 = "original content\nnew from push\n";
  const v0_edit = "original content\nlocal edit\n";

  const remoteDiff_v0_v1 = makeDiff(v0, v1);
  const localDiff_v0_v0edit = makeDiff(v0, v0_edit);

  const diffs: DiffWithOrigin[] = [
    { diff: localDiff_v0_v0edit, origin: "local" },
    { diff: remoteDiff_v0_v1, origin: "remote" },
  ];

  const result = reconstructContent(v0_edit, diffs);
  assert.equal(result, v0);
});

test("reconstructContent: complex content with modifications in the middle", () => {
  // Realistic multi-line file with changes in the middle
  const v0 = "# Title\n\nParagraph one.\n\nParagraph two.\n\nParagraph three.\n";
  const v1 = "# Title\n\nParagraph one.\n\nUpdated paragraph two.\n\nParagraph three.\n";
  const v2 = "# Title\n\nParagraph one.\n\nUpdated paragraph two.\n\nParagraph three.\n\nNew section.\n";
  const v3 = "# New Title\n\nParagraph one.\n\nUpdated paragraph two.\n\nParagraph three.\n\nNew section.\n";

  const remoteDiff_v0_v1 = makeDiff(v0, v1);
  const remoteDiff_v1_v2 = makeDiff(v1, v2);
  const localDiff_v2_v3 = makeDiff(v2, v3);

  // Restore all the way back to v0
  const allDiffs: DiffWithOrigin[] = [
    { diff: localDiff_v2_v3, origin: "local" },
    { diff: remoteDiff_v1_v2, origin: "remote" },
    { diff: remoteDiff_v0_v1, origin: "remote" },
  ];

  const result = reconstructContent(v3, allDiffs);
  assert.equal(result, v0);

  // Restore to v1 (undo local + last remote only)
  const diffs_to_v1: DiffWithOrigin[] = [
    { diff: localDiff_v2_v3, origin: "local" },
    { diff: remoteDiff_v1_v2, origin: "remote" },
  ];
  const result_v1 = reconstructContent(v3, diffs_to_v1);
  assert.equal(result_v1, v1);
});

test("reconstructContent: multiple remote pushes, no local changes, restore from pulled state", () => {
  // User pulled v3 (latest), no local edits. Restore to v0.
  // All remote diffs should be reverse-applied since cache is at NEW side.
  const v0 = "aaa\n";
  const v1 = "aaa\nbbb\n";
  const v2 = "aaa\nbbb\nccc\n";
  const v3 = "aaa\nbbb\nccc\nddd\n";

  const remoteDiff_v0_v1 = makeDiff(v0, v1);
  const remoteDiff_v1_v2 = makeDiff(v1, v2);
  const remoteDiff_v2_v3 = makeDiff(v2, v3);

  const diffs: DiffWithOrigin[] = [
    { diff: remoteDiff_v2_v3, origin: "remote" },
    { diff: remoteDiff_v1_v2, origin: "remote" },
    { diff: remoteDiff_v0_v1, origin: "remote" },
  ];

  const result = reconstructContent(v3, diffs);
  assert.equal(result, v0);
});

// ══════════════════════════════════════════════════════════════════════════════
// reconstructContent — edge cases
// ══════════════════════════════════════════════════════════════════════════════

test("reconstructContent: empty diffs array returns current content unchanged", () => {
  const result = reconstructContent("hello\n", []);
  assert.equal(result, "hello\n");
});

test("reconstructContent: returns null if reverse-apply fails mid-chain", () => {
  // Construct a valid chain then corrupt one diff
  const _v0 = "aaa\n";
  const v1 = "aaa\nbbb\n";
  const v2 = "aaa\nbbb\nccc\n";

  const localDiff_v1_v2 = makeDiff(v1, v2);
  // Intentionally wrong diff (from unrelated content)
  const corruptDiff = makeDiff("xxx\nyyy\n", "zzz\n");

  const diffs: DiffWithOrigin[] = [
    { diff: localDiff_v1_v2, origin: "local" },
    { diff: corruptDiff, origin: "local" },
  ];

  const result = reconstructContent(v2, diffs);
  assert.equal(result, null);
});

test("reconstructContent: content without trailing newline", () => {
  const base = "no trailing newline";
  const current = "no trailing newline\nadded line";
  const diff = makeDiff(base, current);

  const diffs: DiffWithOrigin[] = [{ diff, origin: "local" }];
  const result = reconstructContent(current, diffs);
  assert.equal(result, base);
});

test("reconstructContent: Japanese content with remote diff (original bug scenario)", () => {
  // Reproduces the exact scenario from the bug report
  const old_content = "本当にいいお父さんですか？\n本当にいいお母さんですか？";
  const new_content = "本当にいいお父さんですか？\n本当にいいお母さんですか？\naaaaaa";
  const remoteDiff = makeDiff(old_content, new_content);

  // Cache has old_content (the change was pushed but not yet reflected locally)
  // This was the original failing case: reverse-apply would fail because
  // old_content is at the OLD side of the diff, not the NEW side.
  const diffs: DiffWithOrigin[] = [{ diff: remoteDiff, origin: "remote" }];
  const result = reconstructContent(old_content, diffs);

  // Should skip the remote diff (canApplyForward detects OLD side) and return as-is
  assert.equal(result, old_content);
});

test("reconstructContent: Japanese content with remote diff, content at NEW side", () => {
  const old_content = "本当にいいお父さんですか？\n本当にいいお母さんですか？";
  const new_content = "本当にいいお父さんですか？\n本当にいいお母さんですか？\naaaaaa";
  const remoteDiff = makeDiff(old_content, new_content);

  // Cache has new_content (pulled the latest) — should reverse-apply
  const diffs: DiffWithOrigin[] = [{ diff: remoteDiff, origin: "remote" }];
  const result = reconstructContent(new_content, diffs);
  assert.equal(result, old_content);
});

// ══════════════════════════════════════════════════════════════════════════════
// Mixed scenario: local edits + multiple remote versions back (user's request)
// ══════════════════════════════════════════════════════════════════════════════

test("reconstructContent: 3 remote pushes + 2 local edits, restore to earliest remote", () => {
  // Full realistic scenario:
  //   Remote push 1: v0 → v1 (add paragraph)
  //   Remote push 2: v1 → v2 (modify paragraph)
  //   Remote push 3: v2 → v3 (add footer)
  //   Pull v3 to local
  //   Local edit 1: v3 → v4 (fix typo)
  //   Local edit 2: v4 → v5 (add header comment)
  //
  // Cache = v5. Restore to remote push 1 → should get v0.

  const v0 = "Hello World\n";
  const v1 = "Hello World\nNew paragraph.\n";
  const v2 = "Hello World\nModified paragraph.\n";
  const v3 = "Hello World\nModified paragraph.\n---\nFooter\n";
  const v4 = "Hello World!\nModified paragraph.\n---\nFooter\n";
  const v5 = "// comment\nHello World!\nModified paragraph.\n---\nFooter\n";

  const remoteDiff_v0_v1 = makeDiff(v0, v1);
  const remoteDiff_v1_v2 = makeDiff(v1, v2);
  const remoteDiff_v2_v3 = makeDiff(v2, v3);
  const localDiff_v3_v4 = makeDiff(v3, v4);
  const localDiff_v4_v5 = makeDiff(v4, v5);

  // All entries newest-first
  const allDiffs: DiffWithOrigin[] = [
    { diff: localDiff_v4_v5, origin: "local" },
    { diff: localDiff_v3_v4, origin: "local" },
    { diff: remoteDiff_v2_v3, origin: "remote" },
    { diff: remoteDiff_v1_v2, origin: "remote" },
    { diff: remoteDiff_v0_v1, origin: "remote" },
  ];

  const result = reconstructContent(v5, allDiffs);
  assert.equal(result, v0);

  // Restore to v2 (before remote push 3)
  const diffs_to_v2: DiffWithOrigin[] = allDiffs.slice(0, 3);
  const result_v2 = reconstructContent(v5, diffs_to_v2);
  assert.equal(result_v2, v2);

  // Restore to v3 (before local edits, undo only local diffs)
  const diffs_to_v3: DiffWithOrigin[] = allDiffs.slice(0, 2);
  const result_v3 = reconstructContent(v5, diffs_to_v3);
  assert.equal(result_v3, v3);
});

test("reconstructContent: local edit overlaps with remote change region", () => {
  // Remote changed line 2, local also changed line 2 differently after pull
  const v0 = "aaa\nbbb\nccc\n";
  const v1 = "aaa\nBBB\nccc\n"; // remote push: bbb → BBB
  const v2 = "aaa\nXXX\nccc\n"; // local edit after pull: BBB → XXX

  const remoteDiff_v0_v1 = makeDiff(v0, v1);
  const localDiff_v1_v2 = makeDiff(v1, v2);

  // Restore all → should get v0
  const diffs: DiffWithOrigin[] = [
    { diff: localDiff_v1_v2, origin: "local" },
    { diff: remoteDiff_v0_v1, origin: "remote" },
  ];

  const result = reconstructContent(v2, diffs);
  assert.equal(result, v0);
});
