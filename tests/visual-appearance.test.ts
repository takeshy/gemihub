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
import { scopedConfig, scopedSource } from "../server/pages.ts";
import { standardTheme } from "../shared/theme-editing.ts";
import { themePart } from "../shared/presentation.ts";
import { designOf, restoreDesign } from "../server/design-versions.ts";
import { ChromePreview } from "../src/SiteChrome.tsx";

const theme = { headerHtml: '<header><h1>Original headline</h1><slot name="navigation"></slot></header>', bodyHtml: '<main><slot name="content"></slot></main>', footerHtml: '<footer><slot name="content"></slot></footer>', css: 'h1{color:#193e32}' };
test("pen changes compact long formatting and repair truly oversized CSS within the selected scope", async () => {
  const current = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", theme: structuredClone(theme) } };
  const before = structuredClone(current);
  let calls = 0;
  const { config } = await proposeVisualAppearance(current, "Adjust the header", [], { target: "part:header", generate: async () => {
    calls++;
    return JSON.stringify({ appearance: { theme: { headerCss: calls === 1 ? ':root{--large:"' + "x".repeat(12000) + '"}' : '/* ' + "formatting".repeat(1600) + ' */ header { padding: 24px; }' } } });
  } });
  assert.equal(calls, 2);
  assert.equal(config.appearance?.theme?.headerCss, "header{padding:24px;}");
  assert.equal(config.appearance?.theme?.css, theme.css);
  assert.deepEqual(config.footer, current.footer);
  assert.deepEqual(config.rules, current.rules);
  assert.deepEqual(current, before);
});

test("visual generation receives both sides of the conversation as context, with current changes taking priority", async () => {
  const messages = [{ role: "user" as const, text: "Keep the current colors." }, { role: "assistant" as const, text: "The earlier edit was accepted." }];
  const { config } = await proposeVisualAppearance(structuredClone(sample), "Make that heading shorter", [], {
    messages, target: "copy:recentPosts", generate: async request => {
      const input = JSON.parse(request.contents[0].parts![0].text!);
      assert.deepEqual(input.previousMessages, messages);
      assert.equal(input.instruction, "Make that heading shorter");
      assert.match(request.system, /not a list of changes to execute again/);
      assert.match(request.system, /current displayed configuration is authoritative/);
      return JSON.stringify({ appearance: { copy: { recentPosts: "News" } } });
    },
  });
  assert.equal(config.appearance!.copy!.recentPosts, "News");
});
test("header edits receive the annotated screen and publish/restore their HTML, CSS and navigation together", async () => {
  const current = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", theme, copy: { navReserve: "Reserve", recentPosts: "News" } } };
  const headerHtml = theme.headerHtml.replace("Original headline", "Revised headline");
  const media = { mimeType: "image/png" as const, data: "aGVsbG8=" };
  const { config } = await proposeVisualAppearance(current, "Change the circled menu", [], {
    target: "part:header", media, generate: async request => {
      assert.deepEqual(request.contents[0].parts!.at(-1), { inlineData: media });
      return JSON.stringify({ header: { title: "Heading" }, appearance: { theme: { headerHtml, headerCss: '.public-nav{gap:24px}' }, copy: { navReserve: "Book now" } } });
    },
  });
  assert.equal(config.appearance!.copy!.recentPosts, "News");
  assert.equal(themePart(config.appearance!.theme, "footer")!.css, theme.css);
  assert.match(themePart(config.appearance!.theme, "header")!.css, /gap:24px/);
  assert.deepEqual(scopedSource(config, { kind: "shared" }), scopedSource(current, { kind: "shared" }));
  assert.deepEqual(scopedConfig(current, config, { kind: "part", part: "header" }), config);
  assert.deepEqual(scopedConfig(current, config, { kind: "shared" }), current);
  assert.deepEqual(restoreDesign(config, designOf(current), { kind: "part", part: "header" }), current);
  for (const mutate of [
    (c: typeof config) => { c.rules.interval = 60; },
    (c: typeof config) => { c.menus[0].price++; },
    (c: typeof config) => { c.appearance!.theme!.css += "p{color:red}"; },
    (c: typeof config) => { c.appearance!.theme!.footerHtml = '<footer>Changed<slot name="content"></slot></footer>'; },
    (c: typeof config) => { c.appearance!.copy!.recentPosts = "Other"; },
  ]) { const next = structuredClone(config); mutate(next); assert.throws(() => validateVisualChange(current, next, "part:header"), /指定箇所以外/); }
  const standard = { ...structuredClone(sample), appearance: undefined };
  const customized = await proposeVisualAppearance(standard, "Change header spacing", [], { target: "part:header", generate: async () => JSON.stringify({ appearance: { theme: { headerCss: "header{padding:24px}" } } }) });
  assert.equal(customized.config.appearance!.theme!.bodyHtml, standardTheme.bodyHtml);
  assert.match(renderToStaticMarkup(createElement(ChromePreview, { config: customized.config, part: "header" })), /A LITTLE MOMENT, JUST FOR YOU\./);
  const cleared = await proposeVisualAppearance(customized.config, "Remove header styles", [], { target: "part:header", generate: async () => JSON.stringify({ appearance: { theme: { headerCss: "" } } }) });
  assert.equal(cleared.config.appearance!.theme!.headerCss, undefined);
  const navigationOnly = await proposeVisualAppearance(standard, "Rename navigation", [], { target: "part:header", generate: async () => JSON.stringify({ appearance: { copy: { navReserve: "Book" } } }) });
  assert.equal(navigationOnly.config.appearance!.copy!.navReserve, "Book");
  assert.equal(navigationOnly.config.appearance!.theme, undefined);
  const emptyCopy = { ...standard, appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", copy: {} } };
  assert.equal(validateVisualChange(emptyCopy, { ...emptyCopy, header: { ...emptyCopy.header, title: "Heading" } }, "part:header").header.title, "Heading");
  await assert.rejects(proposeVisualAppearance(standard, "Restyle navigation", [], { target: "part:header", generate: async () => JSON.stringify({ appearance: { theme: { headerCss: 'header{background:url(https://example.com/track)}' } } }) }));
});
test("a partial visual proposal preserves the rest of the theme and all business data", async () => {
  const current = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", theme } };
  const bodyHtml = theme.bodyHtml.replace("<main>", '<main class="calm">');
  const {config, summary} = await proposeVisualAppearance(current, "Change the frame", [], {generate:async () => JSON.stringify({appearance:{theme:{bodyHtml}}})});
  assert.equal(config.appearance!.theme!.bodyHtml, bodyHtml);
  assert.deepEqual({...config.appearance!.theme,bodyHtml:theme.bodyHtml}, theme);
  assert.deepEqual({...config,appearance:current.appearance}, current);
  assert.ok(summary.length);
  assert.equal(current.appearance.theme.bodyHtml, theme.bodyHtml);
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

test("a header proposal that restates the standard theme stays valid on a shop without a theme", async () => {
  const current = { ...structuredClone(sample), appearance: undefined };
  const generate = (patch: unknown) => async () => JSON.stringify(patch);
  const copied = await proposeVisualAppearance(current, "Rename", [], { target: "part:header", generate: generate({ appearance: { copy: { navReserve: "Book" }, theme: { headerHtml: standardTheme.headerHtml, headerCss: "" } } }) });
  assert.equal(copied.config.appearance!.copy!.navReserve, "Book");
  assert.equal(copied.config.appearance!.theme, undefined);
  const unchanged = await proposeVisualAppearance(current, "Nothing", [], { target: "part:header", generate: generate({ appearance: { theme: { headerHtml: standardTheme.headerHtml } } }) });
  assert.equal(unchanged.config.appearance, undefined);
  const styled = await proposeVisualAppearance(current, "Gap", [], { target: "part:header", generate: generate({ appearance: { theme: { headerCss: ".public-nav{gap:8px}" } } }) });
  assert.equal(styled.config.appearance!.theme!.headerCss, ".public-nav{gap:8px}");
  await assert.rejects(proposeVisualAppearance(current, "Frame", [], { target: "part:header", generate: generate({ appearance: { theme: { bodyHtml: '<main class="x"><slot name="content"></slot></main>' } } }) }), /指定箇所以外/);
});

test("empty part CSS equals unset CSS, and clearing it removes the key", () => {
  const appearance = { accent: "sage" as const, layout: "standard" as const, imageUrl: "" };
  const unset = { ...structuredClone(sample), appearance: { ...appearance, theme } };
  const empty = { ...structuredClone(sample), appearance: { ...appearance, theme: { ...theme, headerCss: "" } } };
  const styled = { ...structuredClone(sample), appearance: { ...appearance, theme: { ...theme, headerCss: "h1{color:red}" } } };
  const scope = { kind: "part" as const, part: "header" as const };
  assert.deepEqual(scopedSource(empty, scope), scopedSource(unset, scope));
  assert.deepEqual(scopedConfig(styled, empty, scope).appearance!.theme, theme);
});

test("the appearance target cannot change header-owned copy", async () => {
  const current = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", copy: { navReserve: "Reserve" } } };
  await assert.rejects(proposeVisualAppearance(current, "Rename", [], { target: "appearance", generate: async () => JSON.stringify({ appearance: { copy: { navReserve: "Book" } } }) }), /「ページ全体」から修正/);
  const { config } = await proposeVisualAppearance(current, "Colour", [], { target: "appearance", generate: async () => JSON.stringify({ appearance: { accent: "rose", copy: { recentPosts: "News" } } }) });
  assert.equal(config.appearance!.accent, "rose");
  assert.equal(config.appearance!.copy!.navReserve, "Reserve");
});

test("the appearance target cannot change header or footer theme parts, which the shared scope cannot publish", async () => {
  const current = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", theme: { ...theme, headerCss: "h1{color:red}" } } };
  const revised = theme.headerHtml.replace("Original headline", "Revised");
  for (const patch of [{ headerHtml: revised }, { headerCss: "h1{color:blue}" }, { headerCss: "" }, { footerHtml: '<footer class="x"><slot name="content"></slot></footer>' }, { footerCss: "p{color:red}" }])
    await assert.rejects(proposeVisualAppearance(current, "Restyle", [], { target: "appearance", generate: async () => JSON.stringify({ appearance: { theme: patch } }) }), /別に比較・反映するため[\s\S]*「ページ全体」から修正/, JSON.stringify(patch));
  const { config } = await proposeVisualAppearance(current, "Restyle", [], { target: "appearance", generate: async () => JSON.stringify({ appearance: { theme: { css: "p{color:green}" } } }) });
  assert.equal(scopedConfig(current, config, { kind: "shared" }).appearance!.theme!.css, "p{color:green}");
  assert.equal(config.appearance!.theme!.headerCss, "h1{color:red}");
});

test("the eyebrow is a text target exactly when the header fragment shows it", () => {
  const eyebrow = (appearanceTheme: typeof theme) => visualTargets({ ...structuredClone(sample), appearance: { accent: "sage", layout: "standard", imageUrl: "", theme: appearanceTheme } }).some(target => target.id === "copy:headerEyebrow");
  assert.equal(eyebrow({ ...standardTheme, css: "h1{color:red}" }), true);
  assert.equal(eyebrow(theme), false);
});
