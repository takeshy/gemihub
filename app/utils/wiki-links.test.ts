import assert from "node:assert/strict";
import test from "node:test";
import {
  hrefToLocalTarget,
  isLocalDocumentHref,
  localHrefHeading,
  localHrefToPathCandidates,
  resolveLocalHrefFile,
} from "./wiki-links.ts";
import type { FileListItem } from "~/contexts/EditorContext";

const files: FileListItem[] = [
  { id: "1", name: "Overview.md", path: "docs/Overview.md" },
  { id: "2", name: "API.md", path: "docs/reference/API.md" },
  { id: "3", name: "Root.md", path: "Root.md" },
  { id: "4", name: "authentication.md", path: "architechture/api/authentication.md" },
];

test("detects local document hrefs", () => {
  assert.equal(isLocalDocumentHref("notes/next.md"), true);
  assert.equal(isLocalDocumentHref("./next.md#Heading"), true);
  assert.equal(isLocalDocumentHref("https://wails.localhost:34115/docs/next.md"), true);
  assert.equal(isLocalDocumentHref("#Heading"), false);
  assert.equal(isLocalDocumentHref("https://example.com/next.md"), false);
  assert.equal(isLocalDocumentHref("mailto:test@example.com"), false);
});

test("builds path candidates relative to the current document", () => {
  assert.deepEqual(
    localHrefToPathCandidates("docs/current.md", "./Overview"),
    ["docs/Overview", "docs/Overview.md", "Overview", "Overview.md"],
  );
  assert.deepEqual(
    localHrefToPathCandidates("docs/guides/current.md", "../reference/API.md#Auth"),
    ["docs/reference/API.md", "reference/API.md"],
  );
  assert.deepEqual(
    localHrefToPathCandidates("architechture/frontend-spa.md", "/api/authentication.md"),
    ["api/authentication.md", "architechture/api/authentication.md"],
  );
});

test("resolves local hrefs against file list", () => {
  assert.equal(resolveLocalHrefFile(files, "docs/current.md", "./Overview")?.id, "1");
  assert.equal(resolveLocalHrefFile(files, "docs/guides/current.md", "../reference/API.md#Auth")?.id, "2");
  assert.equal(resolveLocalHrefFile(files, "docs/current.md", "/Root")?.id, "3");
  assert.equal(resolveLocalHrefFile(files, "architechture/frontend-spa.md", "/api/authentication.md")?.id, "4");
});

test("decodes wails localhost URLs and headings", () => {
  const href = "https://wails.localhost:34115/docs/reference/API.md#Auth%20Flow";
  assert.equal(hrefToLocalTarget(href), "/docs/reference/API.md#Auth Flow");
  assert.equal(localHrefHeading("./API.md#Auth%20Flow"), "Auth Flow");
});
