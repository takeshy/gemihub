import type { Theme } from "./presentation.ts";
import { themeStylesInstruction } from "./theme-styles.ts";

// A neutral template for parts that have not been customized. Creating one part must
// not also publish the other parts' local HTML or an unfinished shared stylesheet.
export const standardTheme: Theme = {
  headerHtml: '<header class="site-header"><section class="salon-hero"><slot name="title"></slot><slot name="subtitle"></slot><slot name="details"></slot><slot name="image"></slot></section><slot name="navigation"></slot></header>',
  bodyHtml: '<main><slot name="content"></slot></main>',
  footerHtml: '<footer class="site-footer"><slot name="content"></slot></footer>',
  css: "",
};
export const defaultAppearance = { accent: "sage" as const, layout: "standard" as const, imageUrl: "" };
export const themeComponentInstruction = "The whole-page preview contains application-rendered Dummy samples of headings, paragraphs, .panel cards, button.primary, plain button, a links, label, input, select, textarea, svg icons, .notice messages and one button.selected. They use the same elements/classes as the real screens. button.selected is the customer's chosen service or time on the booking screen; it takes its colours only from the CSS variables --selected-bg, --selected-border and --selected-ink, so define all three on .public-shop in the base styles to match the theme's colours with readable contrast, and update them whenever the theme colours change. Do not restyle .selected with other declarations. Restyle these through their shared component styles. Never target .theme-placeholder or .theme-sample-* for customer-facing styles: those exist only in the preview. Preserve exactly one navigation slot in headerHtml and exactly one content slot each in bodyHtml and footerHtml. Never hard-code Dummy content or replace slots with imitations of functional widgets. " + themeStylesInstruction;
export type ThemePart = "header" | "body" | "footer";
export const themeHtmlKey = (part: ThemePart) => `${part}Html` as const;
/** Empty part CSS means "unset"; keeping "" would look like a change to an identical part. */
export function compactTheme<T extends Partial<Theme>>(theme: T): T {
  const next = { ...theme };
  if (!next.headerCss) delete next.headerCss;
  if (!next.footerCss) delete next.footerCss;
  if (!next.bodyCss) delete next.bodyCss;
  if (!next.styles?.length) delete next.styles;
  if (next.frame === undefined) delete next.frame;
  return next;
}
/** The eyebrow belongs to the standard header fragment; a custom fragment replaces it. */
export const showsHeaderEyebrow = (theme?: Theme) => !theme || theme.headerHtml === standardTheme.headerHtml;
export const hasThemeFrame = (theme?: Theme) => !!theme && (!!theme.frame || theme.bodyHtml !== standardTheme.bodyHtml || !!theme.css || !!theme.bodyCss);
