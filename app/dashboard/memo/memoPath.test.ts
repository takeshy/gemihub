import assert from "node:assert/strict";
import test from "node:test";
import { decodeMemoPath, encodeMemoPath, memoFileNameFor, sha256Hex } from "./memoPath.ts";

test("encodes posix paths per spec example", () => {
  assert.deepEqual(
    memoFileNameFor("/Users/takeshy/books/go_book.pdf"),
    "_sUsers_stakeshy_sbooks_sgo_ubook.pdf.md",
  );
});

test("encodes windows paths per spec example", () => {
  assert.deepEqual(
    memoFileNameFor("C:\\Users\\takeshy\\doc.md"),
    "C_c_sUsers_stakeshy_sdoc.md.md",
  );
});

test("round-trips paths containing underscores, slashes, and colons", () => {
  const paths = [
    "/Users/takeshy/books/go_book.pdf",
    "/a_/b",
    "/a/_b",
    "/path/with_many___underscores/file_.md",
    "/日本語/フォルダ/メモ_テスト.md",
    "/opt/data:v2/file.txt",
  ];
  for (const path of paths) {
    assert.deepEqual(decodeMemoPath(encodeMemoPath(path)), path);
  }
});

test("round-trips windows paths (separators normalize to /)", () => {
  const encoded = encodeMemoPath("C:\\Users\\takeshy\\doc.md");
  assert.deepEqual(decodeMemoPath(encoded), "C:/Users/takeshy/doc.md");
});

test("does not encode backslash in posix paths", () => {
  const path = "/tmp/back\\slash_file";
  const encoded = encodeMemoPath(path);
  assert.deepEqual(encoded, "_stmp_sback\\slash_ufile");
  assert.deepEqual(decodeMemoPath(encoded), path);
});

test("prefix-free mapping keeps ambiguous inputs distinct", () => {
  assert.deepEqual(encodeMemoPath("a_/b"), "a_u_sb");
  assert.deepEqual(encodeMemoPath("a/_b"), "a_s_ub");
  assert.deepEqual(decodeMemoPath("a_u_sb"), "a_/b");
  assert.deepEqual(decodeMemoPath("a_s_ub"), "a/_b");
});

test("rejects invalid escape sequences", () => {
  assert.deepEqual(decodeMemoPath("bad_name"), null);
  assert.deepEqual(decodeMemoPath("trailing_"), null);
});

test("falls back to truncated name + hash for long paths", () => {
  const longPath = `/books/${"あ".repeat(120)}.pdf`;
  const name = memoFileNameFor(longPath);
  assert.match(name, /\.[0-9a-f]{8}\.md$/);
  const stem = name.replace(/\.[0-9a-f]{8}\.md$/, "");
  const stemBytes = new TextEncoder().encode(stem).length;
  if (stemBytes > 180) throw new Error(`truncated stem is ${stemBytes} bytes`);
  assert.deepEqual(name.endsWith(`.${sha256Hex(longPath).slice(0, 8)}.md`), true);
  // Deterministic: same path, same name.
  assert.deepEqual(memoFileNameFor(longPath), name);
});

test("short names do not use the fallback", () => {
  assert.deepEqual(memoFileNameFor("/a/b.md").includes(".md"), true);
  assert.deepEqual(/\.[0-9a-f]{8}\.md$/.test(memoFileNameFor("/a/b.md")), false);
});

test("sha256 matches known vector", () => {
  assert.deepEqual(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.deepEqual(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  // Multi-block input (> 64 bytes) exercises the chunk loop.
  // Reference: crypto.subtle.digest("SHA-256", "a".repeat(200)).
  assert.deepEqual(
    sha256Hex("a".repeat(200)),
    "c2a908d98f5df987ade41b5fce213067efbcc21ef2240212a41e54b5e7c28ae5",
  );
});
