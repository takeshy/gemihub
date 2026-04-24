import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHtmlPreviewSrcDoc,
  buildMockGemihubScript,
  isRegisterPreviewPage,
  resolveNavTarget,
} from "./html-preview-mock.ts";

test("buildMockGemihubScript escapes script-breaking payloads", () => {
  const script = buildMockGemihubScript({
    "web/__gemihub/api/users/list.json": '{"label":"</script><div>unsafe</div>"}',
  });

  assert.match(script, /\\u003c\/script>\\u003cdiv>unsafe\\u003c\/div>/);
  assert.doesNotMatch(script, /<div>unsafe<\/div>/);
});

test("buildHtmlPreviewSrcDoc strips api.js and injects nav + mock into head", () => {
  const html = [
    "<html>",
    "<head><title>Demo</title></head>",
    '<body><script src="/__gemihub/api.js"></script><script>window.run()</script></body>',
    "</html>",
  ].join("");

  const srcDoc = buildHtmlPreviewSrcDoc(html, "<script>window.gemihub={}</script>");
  const headContent = srcDoc.match(/<head[^>]*>([\s\S]*?)<\/head>/)?.[1] ?? "";

  assert.doesNotMatch(srcDoc, /\/__gemihub\/api\.js/);
  // Nav script installed before the mock.
  assert.match(headContent, /__gemihubNav/);
  // Mock still present.
  assert.match(headContent, /window\.gemihub=\{\}/);
  // Original <title> preserved (injection is prepended, not replaced).
  assert.match(headContent, /<title>Demo<\/title>/);
  // Nav script appears before mock in the head so location overrides install first.
  assert.ok(headContent.indexOf("__gemihubNav") < headContent.indexOf("window.gemihub={}"));
  assert.match(srcDoc, /gemihub-iframe-touch/);
});

test("buildHtmlPreviewSrcDoc injects nav script even when api.js is absent", () => {
  // Plain HTML with internal links still needs navigation interception.
  const html = "<html><head></head><body><h1>Hello</h1></body></html>";

  const srcDoc = buildHtmlPreviewSrcDoc(html, "<script>window.gemihub={}</script>");

  assert.match(srcDoc, /<h1>Hello<\/h1>/);
  // Mock is only injected when the page references api.js — it doesn't.
  assert.doesNotMatch(srcDoc, /window\.gemihub=\{\}/);
  // Nav script still installed.
  assert.match(srcDoc, /__gemihubNav/);
  assert.match(srcDoc, /gemihub-iframe-navigate/);
  assert.match(srcDoc, /gemihub-iframe-touch/);
});

test("nav script intercepts clicks, forms, and location.* assignments", () => {
  const srcDoc = buildHtmlPreviewSrcDoc("<html><head></head><body></body></html>", "");

  // Click handler on <a> elements, capture phase.
  assert.match(srcDoc, /addEventListener\('click'/);
  assert.match(srcDoc, /closest\('a'\)/);
  // Form submit handler.
  assert.match(srcDoc, /addEventListener\('submit'/);
  // location.assign / replace overrides.
  assert.match(srcDoc, /location\.assign=_nav/);
  assert.match(srcDoc, /location\.replace=_nav/);
  // Location.prototype.href setter override (best-effort).
  assert.match(srcDoc, /Location\.prototype,'href'/);
  // Hash / javascript: / data: are skipped in the click handler.
  assert.match(srcDoc, /charAt\(0\)==='#'/);
  assert.match(srcDoc, /indexOf\('javascript:'\)===0/);
  assert.match(srcDoc, /indexOf\('data:'\)===0/);
});

test("gemihub.auth.require routes redirect through __gemihubNav", () => {
  // require() used to do location.href = ..., which blanks the sandboxed iframe.
  // It now calls window.__gemihubNav so the parent IDE can open the login file.
  const script = buildMockGemihubScript({});

  assert.match(script, /require:function\(t,lp\)/);
  // The primary path is window.__gemihubNav, with a direct `location.href = p`
  // only as a fallback when __gemihubNav is undefined — so the emitted code
  // has the exact shape `(window.__gemihubNav||function(p){location.href=p;})(...)`.
  assert.match(script, /\(window\.__gemihubNav\|\|function\(p\)\{location\.href=p;\}\)/);
});

test("resolveNavTarget handles internal absolute paths", () => {
  const idByPath = {
    "web/index.html": "fid-home",
    "web/about.html": "fid-about",
    "web/blogs/index.html": "fid-blogs-index",
    "web/partner/dashboard.html": "fid-dash",
  };

  assert.deepEqual(resolveNavTarget("/", "web", idByPath), { type: "internal", fileName: "web/index.html" });
  assert.deepEqual(resolveNavTarget("/about", "web", idByPath), { type: "internal", fileName: "web/about.html" });
  assert.deepEqual(resolveNavTarget("/about.html", "web", idByPath), { type: "internal", fileName: "web/about.html" });
  // Trailing slash → /index.html
  assert.deepEqual(resolveNavTarget("/blogs/", "web", idByPath), { type: "internal", fileName: "web/blogs/index.html" });
  // Directory-style without trailing slash falls back to /index.html when .html doesn't match
  assert.deepEqual(resolveNavTarget("/blogs", "web", idByPath), { type: "internal", fileName: "web/blogs/index.html" });
  // Nested path
  assert.deepEqual(resolveNavTarget("/partner/dashboard", "web", idByPath), {
    type: "internal",
    fileName: "web/partner/dashboard.html",
  });
  // Query + hash stripped
  assert.deepEqual(resolveNavTarget("/about?x=1#section", "web", idByPath), {
    type: "internal",
    fileName: "web/about.html",
  });
});

test("resolveNavTarget resolves relative paths against currentDir", () => {
  const idByPath = {
    "web/partner/dashboard.html": "fid-dash",
    "web/partner/profile.html": "fid-profile",
    "web/login.html": "fid-login",
  };

  assert.deepEqual(resolveNavTarget("profile.html", "web/partner", idByPath), {
    type: "internal",
    fileName: "web/partner/profile.html",
  });
  assert.deepEqual(resolveNavTarget("./profile.html", "web/partner", idByPath), {
    type: "internal",
    fileName: "web/partner/profile.html",
  });
  assert.deepEqual(resolveNavTarget("../login.html", "web/partner", idByPath), {
    type: "internal",
    fileName: "web/login.html",
  });
});

test("resolveNavTarget classifies external, ignore, and not-found", () => {
  const idByPath = { "web/index.html": "fid-home" };

  assert.deepEqual(resolveNavTarget("https://example.com/x", "web", idByPath), {
    type: "external",
    url: "https://example.com/x",
  });
  assert.deepEqual(resolveNavTarget("mailto:a@b.com", "web", idByPath), {
    type: "external",
    url: "mailto:a@b.com",
  });
  assert.deepEqual(resolveNavTarget("//cdn.example/x", "web", idByPath), {
    type: "external",
    url: "//cdn.example/x",
  });
  assert.deepEqual(resolveNavTarget("#section", "web", idByPath), { type: "ignore" });
  assert.deepEqual(resolveNavTarget("javascript:void(0)", "web", idByPath), { type: "ignore" });
  assert.deepEqual(resolveNavTarget("data:text/html,<p>x</p>", "web", idByPath), { type: "ignore" });
  assert.deepEqual(resolveNavTarget("", "web", idByPath), { type: "ignore" });
  assert.deepEqual(resolveNavTarget("/nonexistent", "web", idByPath), { type: "not-found" });
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
  // Self-registration pages are UNAUTHENTICATED. me() must return null in
  // preview regardless of how the populated me.json looks, so the page
  // renders in its unauthenticated state (email input + other fields).
  const registerHtml = `<script>await gemihub.post("register", { email })</script>`;
  const script = buildMockGemihubScript(
    { "web/__gemihub/auth/me.json": '{"email":"alice@example.com","name":"Alice"}' },
    registerHtml,
  );

  assert.match(script, /me:function\(\)\{return Promise\.resolve\(null\);\}/);
  const meFn = script.match(/me:function\(\)\{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(meFn, /_m\[/);
});

test("buildMockGemihubScript returns populated me() for non-register pages", () => {
  const protectedHtml = `<script>await gemihub.auth.require("accounts", "/login")</script>`;
  const script = buildMockGemihubScript(
    { "web/__gemihub/auth/me.json": '{"email":"alice@example.com"}' },
    protectedHtml,
  );

  // Non-register page → me() reads from the mock file.
  assert.match(script, /me:function\(t\)\{var f=_m\['web\/__gemihub\/auth\/me\.json'\]/);
});
