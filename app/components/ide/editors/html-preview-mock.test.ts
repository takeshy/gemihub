import assert from "node:assert/strict";
import test from "node:test";
import { buildHtmlPreviewSrcDoc, buildMockGemihubScript, isRegisterPreviewPage } from "./html-preview-mock.ts";

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

test("isRegisterPreviewPage detects gemihub.post register calls", () => {
  assert.equal(isRegisterPreviewPage(`await gemihub.post("register", body)`), true);
  assert.equal(isRegisterPreviewPage(`await gemihub.post('register', body)`), true);
  assert.equal(isRegisterPreviewPage(`await gemihub.post("register/customer", body)`), true);
  assert.equal(isRegisterPreviewPage(`await gemihub.post( "register" , body)`), true);
});

test("isRegisterPreviewPage rejects unrelated endpoints", () => {
  assert.equal(isRegisterPreviewPage(`await gemihub.post("login", body)`), false);
  assert.equal(isRegisterPreviewPage(`await gemihub.post("registered-users", body)`), false);
  assert.equal(isRegisterPreviewPage(`await gemihub.get("register", body)`), false);
  assert.equal(isRegisterPreviewPage(undefined), false);
  assert.equal(isRegisterPreviewPage(""), false);
});

test("buildMockGemihubScript returns null me() for register pages", () => {
  const registerHtml = `<script>await gemihub.post("register", { email })</script>`;
  const script = buildMockGemihubScript(
    { "web/__gemihub/auth/me.json": '{"email":"alice@example.com"}' },
    registerHtml,
  );

  // Register page → me() short-circuits to null regardless of the populated mock.
  assert.match(script, /me:function\(\)\{[^}]*return Promise\.resolve\(null\)/);
  // The register-path impl never reads from the me.json mock entry.
  const meFn = script.match(/me:function\(\)\{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(meFn, /_m\['web\/__gemihub\/auth\/me\.json'\]/);
});

test("buildMockGemihubScript returns populated me() for non-register pages", () => {
  const protectedHtml = `<script>await gemihub.auth.require("accounts", "/login")</script>`;
  const script = buildMockGemihubScript(
    { "web/__gemihub/auth/me.json": '{"email":"alice@example.com"}' },
    protectedHtml,
  );

  // Non-register page → me() reads from the mock file.
  assert.match(script, /me:function\(t\)\{[^}]*_m\['web\/__gemihub\/auth\/me\.json'\]/);
});
