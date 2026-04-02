import assert from "node:assert/strict";
import test from "node:test";
import { buildHtmlPreviewSrcDoc, buildMockGemihubScript } from "./html-preview-mock.ts";

test("buildMockGemihubScript escapes script-breaking payloads", () => {
  const script = buildMockGemihubScript({
    "web/__gemihub/api/users/list.json": '{"label":"</script><div>unsafe</div>"}',
  });

  assert.match(script, /\\u003c\/script>\\u003cdiv>unsafe\\u003c\/div>/);
  assert.doesNotMatch(script, /<div>unsafe<\/div>/);
});

test("buildHtmlPreviewSrcDoc strips api.js and injects mock into head", () => {
  const html = [
    "<html>",
    "<head><title>Demo</title></head>",
    '<body><script src="/__gemihub/api.js"></script><script>window.run()</script></body>',
    "</html>",
  ].join("");

  const srcDoc = buildHtmlPreviewSrcDoc(html, "<script>window.gemihub={}</script>");

  assert.doesNotMatch(srcDoc, /\/__gemihub\/api\.js/);
  assert.match(srcDoc, /<head><script>window\.gemihub=\{\}<\/script><title>Demo<\/title><\/head>/);
  assert.match(srcDoc, /gemihub-iframe-touch/);
});

test("buildHtmlPreviewSrcDoc keeps html unchanged when api.js is absent", () => {
  const html = "<html><body><h1>Hello</h1></body></html>";

  const srcDoc = buildHtmlPreviewSrcDoc(html, "<script>window.gemihub={}</script>");

  assert.match(srcDoc, /<h1>Hello<\/h1>/);
  assert.doesNotMatch(srcDoc, /window\.gemihub=\{\}/);
  assert.match(srcDoc, /gemihub-iframe-touch/);
});
