import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sample, shopSchema } from "../server/domain.ts";
import { postKey } from "../server/post-domain.ts";
import { fixtureScope, fixturePostEntries, hasFixtureFields } from "../src/fixture-scope.ts";
import { sampleFixtures } from "../src/local-preview.ts";
import { FixtureEditor } from "../src/FixtureEditor.tsx";

test("sample editors show only the fields used by each screen", () => {
  const config = shopSchema.parse(sample), fixtures = sampleFixtures(config);
  const markup = (screen: string, key?: string) => renderToStaticMarkup(createElement(FixtureEditor, { config, value: fixtures, scope: fixtureScope(config, screen, key), onChange() {} }));
  for (const screen of ["about", "part:header", "part:footer", "theme", "page:faq"])
    assert.equal(hasFixtureFields(fixtureScope(config, screen)), false, screen);
  assert.match(markup("reserve"), /サンプルのお客様名/);
  assert.match(markup("reserve"), /サンプル予約/);
  assert.doesNotMatch(markup("reserve"), /サンプル記事|予約のお名前/);
  assert.match(markup("contact"), /サンプルのお客様名/);
  assert.doesNotMatch(markup("contact"), /サンプル予約|サンプル記事/);
  assert.match(markup("mine"), /サンプル予約/);
  assert.match(markup("mine"), /予約のお名前/);
  assert.match(markup("mine"), /サンプル記事/);
  assert.doesNotMatch(markup("mine"), /記事の本文|記事の紹介文/);
  const blogs = markup("blogs");
  assert.match(blogs, /記事タイトル/);
  assert.doesNotMatch(blogs, /記事の本文|記事の紹介文|サンプルのお客様名|サンプル予約/);
  assert.ok(!blogs.includes(fixtures.posts.find(post => post.category === "announcements")!.title));
  const blog = fixtures.posts.find(post => post.category === "blogs")!;
  fixtures.posts.push({ ...blog, slug: "another-blog", title: "OTHER ARTICLE" });
  const article = markup("blogs:article", postKey(blog));
  assert.match(article, /記事の本文/);
  assert.doesNotMatch(article, /OTHER ARTICLE|記事の紹介文|サンプル記事を追加|このサンプル記事を削除/);
  assert.deepEqual(fixturePostEntries(fixtures, fixtureScope(config, "blogs:article", postKey(blog))).map(entry => entry.post.title), [blog.title]);
  const scope = fixtureScope(config, "blogs:article", postKey(blog), fixtures);
  const edited = structuredClone(fixtures);
  edited.posts[0].date = "2026-12-01";
  assert.equal(fixturePostEntries(edited, scope)[0].index, 0, "editing the date keeps the selected article's fields visible until applied");
});

test("article samples respect enabled categories and optional recent-news slots", () => {
  const original = shopSchema.parse(sample), fixtures = sampleFixtures(original);
  const config = shopSchema.parse({ ...original, appearance: { accent: "sage", layout: "standard", imageUrl: "", articles: { blogs: false, announcements: true } } });
  assert.deepEqual(fixtureScope(config, "mine").postCategories, ["announcements"]);
  assert.equal(hasFixtureFields(fixtureScope(config, "blogs")), false);
  assert.ok(fixturePostEntries(fixtures, fixtureScope(config, "announcements")).every(entry => entry.post.category === "announcements"));
  config.screens = { mine: { html: '<section><slot name="mypage"></slot></section>', css: "" } };
  assert.deepEqual(fixtureScope(config, "mine").postCategories, [], "a custom My page without news does not show article editors");
  const post = fixtures.posts[0];
  fixtures.posts = Array.from({ length: 7 }, (_, i) => ({ ...post, slug: `post-${i}` }));
  assert.equal(fixturePostEntries(fixtures, fixtureScope(original, "mine")).length, 5);
});
