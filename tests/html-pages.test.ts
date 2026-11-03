import { test } from "node:test";
import assert from "node:assert/strict";
import { sample, shopSchema } from "../server/domain.ts";
import { renderCustomPage } from "../server/page-renderer.tsx";
import type { ShopPage } from "../server/pages.ts";

const shell = '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>';
const base: ShopPage = { id: "story", slug: "story", title: "お店の物語", navigationLabel: "物語", body: "", layout: "standard", imageUrl: "" };
const withPage = (page: ShopPage) => ({ ...structuredClone(sample), pages: [page] });

test("custom pages are checked HTML with page-scoped CSS; unsafe markup is rejected", () => {
  const html: ShopPage = { ...base, body: '<section class="hero"><h2>ようこそ</h2><p class="lead">季節のネイル</p><img data-image-id="' + "a".repeat(64) + '" alt="店内"></section>', css: ".hero { display: grid; animation: rise .6s ease-out; } @keyframes rise { from { opacity: 0; } to { opacity: 1; } }" };
  shopSchema.parse(withPage(html));
  const rendered = renderCustomPage(html, shell);
  assert.match(rendered, /<section class="hero"><h2>ようこそ<\/h2>/);
  assert.match(rendered, /<style>[^<]*\.hero/, "the page CSS is scoped and delivered");
  assert.doesNotMatch(rendered, /<script/);
  shopSchema.parse(withPage({ ...base, body: "" }));

  for (const [body, css] of [
    ['<p onclick="steal()">x</p>', ""],
    ["<script>alert(1)</script>", ""],
    ['<iframe src="https://example.com"></iframe>', ""],
    ['<form action="/x"><input name="card"></form>', ""],
    ["<p>x</p>", "@import url(https://evil.example/x.css);"],
    ["<p>x</p>", ".a { background: url(https://evil.example/t.png); }"],
  ]) assert.throws(() => shopSchema.parse(withPage({ ...html, body, css })), Error, body + css);
});
