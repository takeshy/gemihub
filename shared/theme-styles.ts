import postcss, { type ChildNode } from "postcss";
import selectorParser from "postcss-selector-parser";
import { z } from "zod";
import { tr } from "./i18n.ts";

export const themeCssLimit = 24000;
export const componentCssLimit = 12000;
export const styleComponents = ["base", "typography", "buttons", "cards", "forms", "icons", "notices", "navigation"] as const;
export type StyleComponent = typeof styleComponents[number];
export const themeStyleSchema = z.strictObject({
  id: z.string().min(1).max(80).regex(/^[a-z][a-z0-9-]*$/),
  component: z.enum(styleComponents),
  css: z.string().max(componentCssLimit),
});
export const themeStylesSchema = z.array(themeStyleSchema).max(128).superRefine((styles, ctx) => {
  if (new Set(styles.map(style => style.id)).size !== styles.length) ctx.addIssue({ code: "custom", message: tr("共通部品のIDが重複しています。") });
  if (styles.reduce((total, style) => total + style.css.length, 0) > 96000) ctx.addIssue({ code: "custom", message: tr("共通部品のCSSの合計が上限を超えています。") });
});
export type ThemeStyle = z.infer<typeof themeStyleSchema>;
export type StyledTheme = { css: string; frame?: boolean; styles?: ThemeStyle[]; bodyCss?: string; headerCss?: string; footerCss?: string };
export function componentLabel(component: StyleComponent): string {
  return { base: tr("共通の色・基本スタイル"), typography: tr("見出し・文章"), buttons: tr("ボタン"), cards: tr("カード"), forms: tr("入力欄"), icons: tr("アイコン"), notices: tr("案内・エラー表示"), navigation: tr("ナビゲーション") }[component];
}
export const sharedThemeCss = (theme: StyledTheme) => [theme.css, ...(theme.styles || []).map(style => style.css)].filter(Boolean).join("\n");

/** Classify by the element being styled; ancestor classes do not own descendants. */
export function selectorComponent(selector: string): StyleComponent {
  try {
    const groups = selectorParser().astSync(selector).nodes.map(group => {
      const lastCombinator = group.nodes.findLastIndex(node => node.type === "combinator");
      const names = group.nodes.slice(lastCombinator + 1).filter(node => node.type === "tag" || node.type === "class").map(node => node.value.toLowerCase());
      if (names.some(name => /^(?:icon(?:-|$)|svg$|path$|circle$|hero-flower$)/.test(name))) return "icons";
      if (names.some(name => /^(?:button$|btn(?:-|$)|primary$|secondary$)/.test(name))) return "buttons";
      if (names.some(name => /^(?:input$|select$|textarea$|label$|fieldset$|form(?:-|$))/.test(name))) return "forms";
      if (names.some(name => /^(?:panel$|card(?:-|$))/.test(name))) return "cards";
      if (names.some(name => /^(?:notice(?:-|$)|alert(?:-|$)|error(?:-|$))/.test(name))) return "notices";
      if (names.some(name => /^(?:public-nav$|nav$|navigation(?:-|$))/.test(name))) return "navigation";
      if (names.some(name => /^(?:h[1-6]$|p$|a$|blockquote$|small$|strong$|em$|heading(?:-|$))/.test(name))) return "typography";
      return "base";
    });
    return groups.every(group => group === groups[0]) ? groups[0] as StyleComponent : "base";
  } catch { return "base"; }
}

/** Split without dropping rules or changing cascade order. Unknown rules remain shared. */
export function splitThemeStyles<T extends StyledTheme>(theme: T): T {
  if (!theme.css.trim()) return theme;
  try {
    const pieces: { component: StyleComponent; css: string }[] = [];
    function visit(node: ChildNode, wrappers: ChildNode[] = []) {
      // Repeating media/supports/container conditions preserves their position and meaning.
      // Keep layers/keyframes intact: splitting anonymous layers changes the cascade.
      if (node.type === "atrule" && ["media", "supports", "container"].includes(node.name.toLowerCase()) && node.nodes) {
        for (const child of node.nodes) visit(child, [...wrappers, node]);
        return;
      }
      let copy = node.clone();
      for (const wrapper of [...wrappers].reverse()) {
        const parent = wrapper.clone();
        if (parent.type !== "atrule") return;
        parent.removeAll(); parent.append(copy); copy = parent;
      }
      const component = node.type === "rule" ? selectorComponent(node.selector) : "base";
      const css = copy.toString();
      const previous = pieces.at(-1);
      if (previous?.component === component && previous.css.length + css.length + 1 <= componentCssLimit) previous.css += "\n" + css;
      else pieces.push({ component, css });
    }
    const root = postcss.parse(theme.css);
    for (const node of root.nodes) visit(node);
    const used = new Set((theme.styles || []).map(style => style.id));
    let sequence = 0;
    const styles = [...pieces.map(piece => {
      let id: string; do { id = `split-${++sequence}`; } while (used.has(id));
      used.add(id); return { id, ...piece };
    }), ...(theme.styles || [])];
    // A single huge rule or unusual document remains intact for a deliberate edit.
    if (!themeStylesSchema.safeParse(styles).success) return theme;
    return { ...theme, frame: true, css: "", styles };
  } catch { return theme; }
}

export const themeStylesInstruction = "Store shared component CSS in ordered theme.styles entries {id, component, css}, with stable unique IDs. Components are base (shared color variables and defaults), typography, buttons, cards, forms, icons, notices, navigation. Put all responsive and interaction states for a component in its entries. Preserve entry order because the CSS cascade depends on it. Use headerCss only for header-specific layout, footerCss for footer-specific layout, and bodyCss for the central frame. Reserve theme.css for shared legacy/general CSS; prefer an empty string and separated styles for new themes. Screen-specific layout belongs in screens.ID.css. Never put working forms or widgets into generated HTML. Change only requested modules and preserve unrelated HTML, styles and business data.";
