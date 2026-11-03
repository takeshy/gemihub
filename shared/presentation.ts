import { z } from "zod";
import { parseFragment, serialize, type DefaultTreeAdapterTypes as Html } from "parse5";
import postcss, { type Declaration } from "postcss";
import selectorParser from "postcss-selector-parser";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { tr } from "./i18n.ts";

export type Presentation = { html: string; css: string };
// Scoped theme CSS does not stop the application's global element rules from
// entering a design. Restore structural defaults before applying generated CSS.
// Keep specificity below generated rules, including plain header/footer rules.
export const presentationBaseCss = `.design-root :where(header, footer) { display:block; height:auto; align-items:normal; justify-content:normal; gap:normal; padding:0; border:0; background:transparent; color:inherit; font:inherit; }
.design-root :where(main) { min-height:0; }
.design-root :where([data-design-slot], .public-nav) { min-width:0; }
.design-root :where(.public-nav) { flex-wrap:wrap; }`;
export const presentationTags = new Set("a abbr article aside b blockquote br caption circle clipPath code col colgroup dd defs details div dl dt ellipse em figcaption figure footer g h1 h2 h3 h4 h5 h6 header hr i img li line linearGradient main mark nav ol p path polygon polyline pre radialGradient rect s section slot small span stop strong sub summary sup svg table tbody td text th thead time tr u ul".split(" ").map(t => t.toLowerCase()));
const atRules = new Set(["media", "supports", "container", "layer", "keyframes", "-webkit-keyframes"]);
type Compiled = { nodes: Html.ChildNode[]; css: string; id: string; slots: string[]; imageIds: string[]; animations: Map<string, string> };
const cache = new Map<string, Compiled>();
function invalid(reason = ""): never { throw new Error(tr("表示用HTML・CSSを確認してください。スクリプト・独自のフォーム・外部CSSの読み込みは使えません。") + (reason ? ` ${reason}` : "")); }
export function presentationUrl(value: string, image = false) {
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) return value;
  if (/^https:\/\//i.test(value)) { try { const url = new URL(value); return url.username || url.password ? undefined : value; } catch { return undefined; } }
  if (!image && (/^\/(?!\/)/.test(value) || /^#[a-zA-Z0-9_-]*$/.test(value))) return value;
  return undefined;
}
function checkDeclaration(decl: Declaration, animations: Map<string, string>) {
  if (/[\\<]/.test(decl.prop + decl.value) || /(?:expression|image-set|cross-fade|paint)\s*\(/i.test(decl.value) || /^(?:behavior|-moz-binding)$/i.test(decl.prop)) invalid();
  const withoutFragments = decl.value.replace(/url\(\s*["']?#[a-zA-Z0-9_-]+["']?\s*\)/gi, "");
  if (/url\s*\(/i.test(withoutFragments)) invalid("CSS url() only supports local #fragment references; use an img for permitted image assets.");
  if (/^(?:-webkit-)?animation(?:-name)?$/.test(decl.prop)) {
    for (const [name, scoped] of animations) decl.value = decl.value.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), scoped);
  }
}
export function presentationStyle(value: string, animations = new Map<string, string>()): Record<string, string> {
  const root = postcss.parse(`x{${value}}`);
  const rule = root.first;
  if (root.nodes.length !== 1 || !rule || rule.type !== "rule" || rule.selector !== "x") invalid();
  const result: Record<string, string> = {};
  rule.each(node => {
    if (node.type === "comment") return;
    if (node.type !== "decl") invalid();
    checkDeclaration(node, animations);
    const name = node.prop.startsWith("--") ? node.prop : node.prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    // Inline !important is unnecessary; scoped CSS supports it without changing this object's shape.
    result[name] = node.value;
  });
  return result;
}
export function compilePresentation(design: Presentation): Compiled {
  if (/[\\<]/.test(design.css)) invalid();
  const id = "design-" + bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(design)))).slice(0, 16);
  const cached = cache.get(id); if (cached) return cached;
  const nodes = parseFragment(design.html).childNodes;
  const slots: string[] = []; const imageIds: string[] = []; let count = 0;
  const inspect = (node: Html.ChildNode, depth: number) => {
    if (++count > 4000 || depth > 40) invalid();
    if (!("tagName" in node)) return;
    if (!presentationTags.has(node.tagName.toLowerCase())) invalid(`Unsupported HTML element: ${node.tagName}.`);
    for (const attr of node.attrs) {
      const svgNamespace = node.tagName === "svg" && attr.name === "xmlns" && attr.value === "http://www.w3.org/2000/svg";
      if (attr.namespace && !svgNamespace || /^on/i.test(attr.name) || ["srcdoc", "form", "formaction", "action", "srcset"].includes(attr.name)) invalid(`Unsupported attribute: ${node.tagName}.${attr.name}.`);
      if (attr.name === "href" && !presentationUrl(attr.value)) invalid();
      if (attr.name === "src" && (node.tagName !== "img" || !presentationUrl(attr.value, true))) invalid();
      if (attr.name === "data-image-id") {
        if (node.tagName !== "img" || !/^[a-f0-9]{64}$/.test(attr.value)) invalid();
        imageIds.push(attr.value);
      }
      if (attr.name === "style") presentationStyle(attr.value);
      if (/url\s*\(/i.test(attr.value) && attr.name !== "style" && !/^url\(#[a-zA-Z0-9_-]+\)$/.test(attr.value)) invalid();
    }
    const slot = node.tagName === "slot" ? node.attrs.find(a => a.name === "name")?.value : node.attrs.find(a => a.name === "data-slot")?.value;
    if (node.tagName === "slot" || slot !== undefined) {
      if (!slot || !/^[a-z][a-z0-9-]*$/.test(slot) || node.childNodes.some(n => n.nodeName !== "#text" || ("value" in n && n.value.trim()))) invalid(`Slot ${slot || "(unnamed)"} must be empty and have an explicit closing tag, for example <slot name="content"></slot>.`);
      slots.push(slot);
    }
    node.childNodes.forEach(child => inspect(child, depth + 1));
  };
  nodes.forEach(node => inspect(node, 0));
  if (slots.length !== new Set(slots).size) invalid();
  const cssRoot = postcss.parse(design.css);
  const animations = new Map<string, string>();
  cssRoot.walkAtRules(rule => {
    if (!atRules.has(rule.name.toLowerCase()) || /[\\<]/.test(rule.params)) invalid();
    if (/keyframes$/i.test(rule.name)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(rule.params)) invalid();
      const name = rule.params; const scoped = `${id}-${name}`; animations.set(name, scoped); rule.params = scoped;
    }
  });
  cssRoot.walkRules(rule => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const parsed = selectorParser().astSync(rule.selector);
    parsed.walkPseudos(pseudo => { if ([":root", ":host"].includes(pseudo.value)) pseudo.replaceWith(selectorParser.className({ value: "design-root" })); });
    parsed.walkTags(tag => { if (["html", "body"].includes(tag.value)) tag.replaceWith(selectorParser.className({ value: "design-root" })); });
    rule.selector = parsed.nodes.map(selector => `.${id} :is(${selector.toString()})`).join(",");
  });
  cssRoot.walkDecls(decl => checkDeclaration(decl, animations));
  const compiled = { nodes, css: cssRoot.toString(), id, slots, imageIds: [...new Set(imageIds)], animations };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(id, compiled); return compiled;
}
export const presentationSchema = z.object({ html: z.string().min(1).max(20000), css: z.string().max(12000) }).superRefine((design, ctx) => {
  try { compilePresentation(design); } catch { ctx.addIssue({ code: "custom", message: tr("表示用HTML・CSSを確認してください。スクリプト・独自のフォーム・外部CSSの読み込みは使えません。") }); }
});
export function presentationSlots(design: Presentation | undefined, allowed: string[], required: string[] = []) {
  if (!design) return true;
  try { const slots = compilePresentation(design).slots; return slots.every(s => allowed.includes(s)) && required.every(s => slots.includes(s)); } catch { return false; }
}

const html = z.string().min(1).max(20000);
export const themeSchema = z.object({ headerHtml: html, bodyHtml: html, footerHtml: html, css: z.string().max(12000) }).superRefine((theme, ctx) => {
  const parts = [
    [theme.headerHtml, ["title", "subtitle", "details", "image", "navigation"], ["navigation"]],
    [theme.bodyHtml, ["content"], ["content"]],
    [theme.footerHtml, ["content"], ["content"]],
  ] as const;
  for (const [index, [html, allowed, required]] of parts.entries()) {
    try {
      const compiled = compilePresentation({ html, css: theme.css });
      if (!compiled.slots.every(slot => (allowed as readonly string[]).includes(slot)) || !required.every(slot => compiled.slots.includes(slot)))
        throw new Error(`Allowed slots: ${allowed.join(", ")}; required slots: ${required.join(", ")}; received: ${compiled.slots.join(", ")}.`);
    } catch (error) {
      ctx.addIssue({ code: "custom", path: [(["headerHtml", "bodyHtml", "footerHtml"] as const)[index]], message: error instanceof Error ? error.message : String(error) });
    }
  }
});
export type Theme = z.infer<typeof themeSchema>;
export const themePart = (theme: Theme | undefined, part: "header" | "body" | "footer"): Presentation | undefined => theme ? { html: theme[`${part}Html`], css: theme.css } : undefined;
export const themeImageIds = (theme?: Theme) => theme ? [...new Set((["header", "body", "footer"] as const).flatMap(part => compilePresentation(themePart(theme, part)!).imageIds))] : [];
export function inlineThemeImages(theme: Theme, images: Record<string, { mimeType: string; data: string }>): Theme {
  const inline = (html: string) => {
    const root = parseFragment(html);
    const visit = (node: Html.ChildNode) => {
      if (!("tagName" in node)) return;
      const id = node.attrs.find(attr => attr.name === "data-image-id")?.value;
      if (id && images[id]) node.attrs = [...node.attrs.filter(attr => !["data-image-id", "src"].includes(attr.name)), { name: "src", value: `data:${images[id].mimeType};base64,${images[id].data}` }];
      node.childNodes.forEach(visit);
    };
    root.childNodes.forEach(visit); return serialize(root);
  };
  return { ...theme, headerHtml: inline(theme.headerHtml), bodyHtml: inline(theme.bodyHtml), footerHtml: inline(theme.footerHtml) };
}
