import assert from "node:assert/strict";
import test from "node:test";
import * as Diff from "diff";
import {
  appendRestoreDiff,
  computeLocalEditStep,
  createDiffStr,
  reverseApplyDiff,
  withCommitBoundary,
  type EditHistoryDiffEntry,
} from "./edit-history-diff.ts";

const T = "2026-01-01T00:00:00.000Z";

// ── createDiffStr: stats ────────────────────────────────────────────────────

test("createDiffStr: deleting a '---' line counts as a deletion", () => {
  const { stats } = createDiffStr("---\ntitle: x\n---\nbody\n", "title: x\n---\nbody\n", 3);
  assert.deepEqual(stats, { additions: 0, deletions: 1 });
});

test("createDiffStr: adding a '++x' line counts as an addition", () => {
  const { stats } = createDiffStr("a\n", "a\n++x\n", 3);
  assert.deepEqual(stats, { additions: 1, deletions: 0 });
});

test("createDiffStr: adding a '---' horizontal rule counts as an addition", () => {
  const { stats } = createDiffStr("a\nb\n", "a\n---\nb\n", 3);
  assert.deepEqual(stats, { additions: 1, deletions: 0 });
});

// ── computeLocalEditStep ────────────────────────────────────────────────────

test("computeLocalEditStep: deleting only a frontmatter '---' is recorded, not treated as a revert", () => {
  const step = computeLocalEditStep([], "---\ntitle: x\n---\nbody\n", "title: x\n---\nbody\n", T);
  assert.equal(step.action, "save");
  assert.ok(step.action === "save" && !step.reverted);
  assert.ok(step.action === "save" && step.diffs.length === 1 && step.diffs[0].stats.deletions === 1);
});

test("computeLocalEditStep: identical content is a no-op", () => {
  assert.deepEqual(computeLocalEditStep([], "a\n", "a\n", T), { action: "none" });
});

test("computeLocalEditStep: edits in one session accumulate into one diff from the base", () => {
  const s1 = computeLocalEditStep([], "a\n", "a\nb\n", T);
  assert.ok(s1.action === "save");
  const s2 = computeLocalEditStep(s1.diffs, "a\nb\n", "a\nb\nc\n", T);
  assert.ok(s2.action === "save");
  assert.equal(s2.diffs.length, 1);
  assert.equal(reverseApplyDiff("a\nb\nc\n", s2.diffs[0].diff), "a\n");
});

test("computeLocalEditStep: reverting the only session deletes the entry", () => {
  const s1 = computeLocalEditStep([], "a\n", "a\nb\n", T);
  assert.ok(s1.action === "save");
  assert.deepEqual(computeLocalEditStep(s1.diffs, "a\nb\n", "a\n", T), { action: "delete" });
});

test("computeLocalEditStep: reverting the second session keeps the sealed first one", () => {
  const s1 = computeLocalEditStep([], "a\n", "a\nb\n", T);
  assert.ok(s1.action === "save");
  const sealed = withCommitBoundary(s1.diffs, T)!;
  const s2 = computeLocalEditStep(sealed, "a\nb\n", "a\nb\nc\n", T);
  assert.ok(s2.action === "save" && s2.diffs.length === 2);
  const s3 = computeLocalEditStep(s2.diffs, "a\nb\nc\n", "a\nb\n", T);
  assert.ok(s3.action === "save" && s3.reverted);
  assert.equal(s3.diffs.filter((d) => d.diff !== "").length, 1);
});

test("computeLocalEditStep: a non-applying last diff starts a new session", () => {
  const bogus: EditHistoryDiffEntry[] = [
    { timestamp: T, diff: createDiffStr("x\n", "y\n", 3).diff, stats: { additions: 1, deletions: 1 } },
  ];
  const step = computeLocalEditStep(bogus, "unrelated\n", "unrelated\nmore\n", T);
  assert.ok(step.action === "save");
  assert.equal(step.diffs.length, 2);
  assert.equal(step.diffs[0].diff, bogus[0].diff);
  assert.equal(reverseApplyDiff("unrelated\nmore\n", step.diffs[1].diff), "unrelated\n");
});

// ── withCommitBoundary / appendRestoreDiff ──────────────────────────────────

test("withCommitBoundary: no boundary for empty history or after an existing boundary", () => {
  assert.equal(withCommitBoundary([], T), null);
  const s1 = computeLocalEditStep([], "a\n", "b\n", T);
  assert.ok(s1.action === "save");
  const sealed = withCommitBoundary(s1.diffs, T)!;
  assert.equal(sealed.length, 2);
  assert.equal(withCommitBoundary(sealed, T), null);
});

test("appendRestoreDiff: seals the session and brackets the restore diff with boundaries", () => {
  const s1 = computeLocalEditStep([], "a\n", "b\n", T);
  assert.ok(s1.action === "save");
  const diffs = appendRestoreDiff(s1.diffs, "b\n", "a\n", T);
  assert.deepEqual(diffs.map((d) => d.diff === ""), [false, true, false, true]);
});

// ── reverseApplyDiff robustness ─────────────────────────────────────────────

test("reverseApplyDiff: handles a diff containing '---' content lines", () => {
  const before = "---\ntitle: x\n---\nbody\n";
  const after = "title: x\n---\nbody\n";
  assert.equal(reverseApplyDiff(after, createDiffStr(before, after, 3).diff), before);
});

test("reverseApplyDiff: accepts a full patch with file headers (legacy project entries)", () => {
  const patch = Diff.createTwoFilesPatch("a", "b", "x\ny\n", "x\nz\n", "", "", { context: 3 });
  assert.equal(reverseApplyDiff("x\nz\n", patch), "x\ny\n");
});

test("reverseApplyDiff: accepts hunk headers without line counts", () => {
  assert.equal(reverseApplyDiff("b\n", "@@ -1 +1 @@\n-a\n+b"), "a\n");
});

test("reverseApplyDiff: returns null instead of throwing on malformed input", () => {
  assert.equal(reverseApplyDiff("a\n", "not a diff"), null);
  assert.equal(reverseApplyDiff("a\n", "@@ -1,1 +1,1 @@\n?garbage"), null);
});
