import { test } from "node:test";
import assert from "node:assert/strict";
import { sample, shopSchema } from "../server/domain.ts";
import { standardTheme, hasThemeFrame } from "../shared/theme-editing.ts";
import { splitThemeStyles, sharedThemeCss } from "../shared/theme-styles.ts";
import { themePart, themeSchema } from "../shared/presentation.ts";
import { proposeVisualAppearance, validateVisualChange, visualTargets } from "../server/visual.ts";
import { scopedConfig } from "../server/pages.ts";
import { designOf, restoreDesign } from "../server/design-versions.ts";
import { exampleTheme } from "../src/stories/themes.ts";

const config = () => shopSchema.parse({ ...structuredClone(sample), appearance: { accent: "sage", layout: "standard", imageUrl: "", theme: structuredClone(exampleTheme) } });

test("splitting accepted CSS preserves repeated-selector cascade, conditions and unknown rules", () => {
  const css = '.panel{color:red}button{color:blue}.panel{color:green}@media(max-width:600px){.icon{color:gold}input{padding:5px}}.unknown{display:grid}@keyframes pulse{from{opacity:0}to{opacity:1}}';
  const theme = { ...standardTheme, css };
  const split = splitThemeStyles(theme);
  assert.equal(split.css, "");
  assert.deepEqual(split.styles!.map(style => style.component), ["cards", "buttons", "cards", "icons", "forms", "base"]);
  assert.match(sharedThemeCss(split), /color:red[\s\S]*color:blue[\s\S]*color:green/);
  assert.match(split.styles![3].css, /@media\(max-width:600px\)\{\.icon\{color:gold\}/);
  assert.match(sharedThemeCss(split), /\.unknown\{display:grid\}/);
  assert.match(sharedThemeCss(split), /@keyframes pulse/);
  assert.deepEqual(splitThemeStyles(split), split);
  assert.equal(theme.css, css);
  assert.doesNotThrow(() => themeSchema.parse(split));
});

test("all surfaces combine shared components and their own part CSS with unchanged safety and limits", () => {
  const c = config(), theme = c.appearance!.theme!;
  for (const part of ["header", "body", "footer"] as const) {
    const css = themePart(theme, part)!.css;
    assert.match(css, /button\.primary/);
    assert.ok(css.endsWith(theme[`${part}Css`]!));
    for (const other of ["header", "body", "footer"] as const) if (other !== part) assert.ok(!css.includes(theme[`${other}Css`]!));
  }
  assert.equal(themeSchema.safeParse({ ...standardTheme, css: ':root{--large:"' + "x".repeat(16000) + '"}' }).success, true);
  assert.equal(themeSchema.safeParse({ ...standardTheme, css: "x".repeat(24001) }).success, false);
  for (const invalid of [
    { ...theme, styles: [{ id: "unsafe", component: "buttons", css: "button{background:url(https://example.com/track)}" }] },
    { ...theme, styles: [theme.styles![0], theme.styles![0]] },
    { ...theme, styles: [{ id: "long", component: "base", css: "x".repeat(12001) }] },
  ]) assert.equal(themeSchema.safeParse(invalid).success, false);
});

test("an icon-only AI edit receives relevant components and preserves every unrelated component and business field", async () => {
  const before = config();
  assert.ok(visualTargets(before).some(target => target.id === "component:icons"));
  const { config: next } = await proposeVisualAppearance(before, "Make the icon green", [], { target: "component:icons", generate: async request => {
    const context = JSON.parse(request.contents[0].parts![0].text!);
    assert.deepEqual(context.appearance.theme.styles.map((style: { component: string }) => style.component), ["base", "icons"]);
    assert.equal(context.appearance.theme.headerCss, undefined);
    assert.equal(context.appearance.theme.bodyCss, undefined);
    assert.equal(context.appearance.theme.footerCss, undefined);
    assert.ok(!("appearance" in (request.schema.properties as object)));
    assert.ok(context.styleCatalog.some((style: { component: string }) => style.component === "buttons"));
    return JSON.stringify({ cssEdits: [{ field: "style", styleId: "icons", selector: ".icon", declarations: [{ property: "color", value: "#008000" }] }] });
  } });
  assert.match(next.appearance!.theme!.styles!.find(style => style.id === "icons")!.css, /#008000/);
  assert.deepEqual(next.appearance!.theme!.styles!.filter(style => style.component !== "icons"), before.appearance!.theme!.styles!.filter(style => style.component !== "icons"));
  assert.deepEqual({ ...next, appearance: before.appearance }, before);
  for (const mutate of [
    (c: typeof next) => { c.appearance!.theme!.styles![2].css = "button{color:red}"; },
    (c: typeof next) => { c.appearance!.theme!.bodyCss = "main{padding:99px}"; },
    (c: typeof next) => { c.menus[0].price++; },
  ]) { const c = structuredClone(next); mutate(c); assert.throws(() => validateVisualChange(before, c, "component:icons")); }
  const legacy = { ...before, appearance: { ...before.appearance!, theme: { ...standardTheme, css: '.icon{color:red}.panel{padding:20px}' } } };
  const generated = await proposeVisualAppearance(legacy, "Change the icon", [], { target: "component:icons", generate: async () => JSON.stringify({ styleEdits: [{ id: "split-1", component: "icons", css: ".icon{color:blue}" }] }) });
  assert.equal(generated.config.appearance!.theme!.css, "");
  assert.equal(generated.config.appearance!.theme!.styles![1].css, ".panel{padding:20px}");
  assert.doesNotThrow(() => validateVisualChange(legacy, generated.config, "component:icons"));
});

test("publication and restoration keep shared components, frame CSS and separate parts in their scopes", () => {
  const before = config(), local = config();
  local.appearance!.theme!.styles![2].css = "button{color:green}";
  local.appearance!.theme!.bodyCss = "main{padding:40px}";
  local.appearance!.theme!.headerCss = "header{padding:90px}";
  const shared = scopedConfig(before, local, { kind: "shared" });
  assert.equal(shared.appearance!.theme!.headerCss, before.appearance!.theme!.headerCss);
  assert.equal(shared.appearance!.theme!.bodyCss, local.appearance!.theme!.bodyCss);
  assert.deepEqual(shared.appearance!.theme!.styles, local.appearance!.theme!.styles);
  const part = scopedConfig(before, local, { kind: "part", part: "header" });
  assert.equal(part.appearance!.theme!.headerCss, local.appearance!.theme!.headerCss);
  assert.deepEqual(part.appearance!.theme!.styles, before.appearance!.theme!.styles);
  const restored = restoreDesign(local, designOf(before), { kind: "theme" });
  assert.deepEqual(restored.appearance!.theme, before.appearance!.theme);
  assert.deepEqual(restored.menus, local.menus);
});

test("a part edit preserves an explicit standard-frame flag", async () => {
  const before = config(); before.appearance!.theme!.frame = false;
  const { config: next } = await proposeVisualAppearance(before, "Change header spacing", [], { target: "part:header", generate: async () => JSON.stringify({ appearance: { theme: { headerCss: "header{padding:40px}" } } }) });
  assert.equal(next.appearance!.theme!.frame, false);
  assert.doesNotThrow(() => validateVisualChange(before, next, "part:header"));
});

test("standard shops can create a component style without replacing the rest of the frame", async () => {
  const before = structuredClone(sample);
  const { config: next } = await proposeVisualAppearance(before, "Make icons green", [], { target: "component:icons", generate: async () => JSON.stringify({ styleEdits: [{ id: "icons", component: "icons", css: ".icon{color:green}" }] }) });
  assert.equal(next.appearance!.theme!.headerHtml, standardTheme.headerHtml);
  assert.equal(hasThemeFrame(next.appearance!.theme), false);
  assert.deepEqual(validateVisualChange(before, next, "component:icons"), next);
  assert.deepEqual(next.menus, before.menus);
});

test("the real identify/propose API accepts component targets, returns progress and leaves publication untouched", async t => {
  const { createApp } = await import("../server/app.ts");
  const { Store } = await import("../server/store.ts");
  const { digest } = await import("../server/auth.ts");
  const intelligence = await import("../server/ai.ts");
  const store = new Store(":memory:");
  const shop = await store.createShop("components@example.com"); shop.published = config(); await store.saveShop(shop);
  await store.put("session", digest("components"), { user: { email: shop.owner, name: "Owner", role: "owner" }, expires: Date.now() + 600000 });
  let invoked = false;
  const server = createApp(store, { ...intelligence,
    identifyVisual: async (_media, targets) => { assert.ok(targets.some(target => target.id === "component:icons")); return { ids: ["component:icons"], explanation: "Change the icon" }; },
    visualAppearance: async (current, instruction, images, options) => { invoked = true; assert.equal(options?.splitStyles, true); return proposeVisualAppearance(current, instruction, images, { ...options, generate: async () => JSON.stringify({ cssEdits: [{ field: "style", styleId: "icons", selector: ".icon", declarations: [{ property: "color", value: "green" }] }] }) }); },
    visualReview: async () => ({ approved: true, issues: [] }),
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const address = server.address() as import("node:net").AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`; process.env.APP_ORIGIN = origin;
  const api = async (path: string, data?: unknown) => {
    const response = await fetch(`${origin}/api/shops/${shop.id}/${path}`, { method: data ? "POST" : "GET", headers: { Origin: origin, Cookie: "gemihub_session=components", "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
    assert.equal(response.status, 200); return response.json();
  };
  const identified = await api("visual/identify", { instruction: "Change the icon", media: { mimeType: "image/png", data: "aGVsbG8=" }, displayed: shop.published, local: { base: shop.revision, source: shop.published, theme: true } });
  const requestId = crypto.randomUUID();
  const result = await api("visual/propose", { id: identified.id, requestId, target: "component:icons", instruction: "Change the icon" });
  assert.ok(invoked); assert.equal(result.visualReview.approved, true);
  assert.match(result.config.appearance.theme.styles.find((style: { id: string }) => style.id === "icons").css, /color:green/);
  assert.equal((await api(`visual/${identified.id}/progress?requestId=${requestId}`)).stage, "complete");
  assert.deepEqual((await store.shop(shop.id))!.published, shop.published);
});
