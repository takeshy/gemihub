import { test } from "node:test";
import assert from "node:assert/strict";
import { sample } from "../server/domain.ts";
import { proposeVisualAppearance, validateVisualChange, visualTargets } from "../server/visual.ts";
import { storefrontText } from "../shared/storefront-copy.ts";
import { requestLocale } from "../server/i18n.ts";
import { validateProposedImages } from "../server/request-images.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticStorefront } from "../src/StaticStorefront.tsx";
import { renderHomeWithPosts } from "../server/post-renderer.tsx";
import { sampleFixtures } from "../src/local-preview.ts";

const theme = { headerHtml: '<header><h1>Original headline</h1><slot name="navigation"></slot></header>', bodyHtml: '<main><slot name="content"></slot></main>', footerHtml: '<footer><slot name="content"></slot></footer>', css: 'h1{color:#193e32}' };
test("a partial visual proposal preserves the rest of the theme and all business data", async () => {
  const current = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", theme } };
  const headerHtml = theme.headerHtml.replace("Original headline", "Your moment of calm.");
  const {config, summary} = await proposeVisualAppearance(current, "Change the headline", [], {generate:async () => JSON.stringify({appearance:{theme:{headerHtml}}})});
  assert.equal(config.appearance!.theme!.headerHtml, headerHtml);
  assert.deepEqual({...config.appearance!.theme,headerHtml:theme.headerHtml}, theme);
  assert.deepEqual({...config,appearance:current.appearance}, current);
  assert.ok(summary.length);
  assert.equal(current.appearance.theme.headerHtml, theme.headerHtml);
});
test("visual proposals reject payment changes, unsafe HTML and incomplete new themes", async () => {
  const current = {...structuredClone(sample),appearance:{accent:"sage" as const,layout:"standard" as const,imageUrl:"",theme}};
  for (const value of [
    {appearance:{accent:"rose"},rules:{payment:{enabled:false}}},
    {appearance:{theme:{headerHtml:'<script>alert(1)</script><slot name="navigation"></slot>'}}},
  ]) await assert.rejects(proposeVisualAppearance(current,"Change the headline",[],{generate:async()=>JSON.stringify(value)}));
  await assert.rejects(proposeVisualAppearance({...current,appearance:undefined},"Create a theme",[],{generate:async()=>JSON.stringify({appearance:{theme:{headerHtml:theme.headerHtml}}})}));
});

test("built-in news copy is selectable, merged without losing other copy, and shared by live and static pages", async () => {
  const current = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", copy: { navMine: "My salon" } } };
  assert.ok(visualTargets(current).some(target => target.id === "copy:recentPosts" && target.label.includes("お店からのお便り")));
  const title = '最新ニュース <img src=x onerror="alert(1)">';
  const { config } = await proposeVisualAppearance(current, "Change the news heading", [], {
    target: "copy:recentPosts", generate: async () => JSON.stringify({ appearance: { copy: { recentPosts: title } } }),
  });
  assert.equal(config.appearance!.copy!.navMine, "My salon");
  assert.deepEqual({ ...config, appearance: current.appearance }, current);
  assert.equal(storefrontText(config, "recentPosts"), title);
  assert.equal(requestLocale.run("en", () => storefrontText(undefined, "recentPosts")), "News from the shop");
  assert.equal(requestLocale.run("en", () => storefrontText(config, "recentPosts")), title);
  const posts = sampleFixtures(config).posts.map((post, index) => ({ ...post, id: `post-${index}`, publishedAt: "2030-01-01T00:00:00Z" }));
  const staticHtml = renderToStaticMarkup(createElement(StaticStorefront, { config, view: { kind: "home", posts }, base: "" }));
  const fallback = renderHomeWithPosts(config, '<html><title>Shop</title><div id="root"></div></html>', posts);
  for (const html of [staticHtml, fallback]) {
    assert.match(html, /最新ニュース &lt;img/);
    assert.doesNotMatch(html, /<img src=x/);
  }
});

test("copy and screen proposals reject changes outside the selected target and preserve required working slots", async () => {
  const current = { ...structuredClone(sample), appearance: undefined };
  const design = { html: '<section><h2>Welcome</h2><slot name="news"></slot><slot name="mypage"></slot></section>', css: "section { gap: 24px }" };
  const { config } = await proposeVisualAppearance(current, "Change this screen's layout", [], {
    target: "screen:mine", generate: async () => JSON.stringify({ screens: { mine: design } }),
  });
  assert.deepEqual(config.screens?.mine, design);
  assert.equal(config.appearance, undefined);
  const copy = { appearance: { copy: { recentPosts: "News", navMine: "Unrequested" } } };
  await assert.rejects(proposeVisualAppearance(current, "Change news only", [], { target: "copy:recentPosts", generate: async () => JSON.stringify(copy) }));
  for (const screens of [
    { mine: { html: "<section>Missing mypage</section>", css: "" } },
    { mine: { html: '<script>alert(1)</script><slot name="mypage"></slot>', css: "" } },
    { mine: design, contact: { html: '<slot name="form"></slot>', css: "" } },
  ]) await assert.rejects(proposeVisualAppearance(current, "Change my page", [], { target: "screen:mine", generate: async () => JSON.stringify({ screens }) }));
  assert.throws(() => validateVisualChange(current, { ...config, rules: { ...config.rules, interval: 60 } }, "screen:mine"));
  const withImage = { ...config, screens: { mine: { ...design, html: design.html + `<img data-image-id="${"e".repeat(64)}" alt="Photo">` } } };
  assert.throws(() => validateProposedImages(withImage, current, []), /画像/);
});
