import type { Theme } from "./presentation.ts";

// A neutral template for parts that have not been customized. Creating one part must
// not also publish the other parts' local HTML or an unfinished shared stylesheet.
export const standardTheme: Theme = {
  headerHtml: '<header class="site-header"><section class="salon-hero"><slot name="title"></slot><slot name="subtitle"></slot><slot name="details"></slot><slot name="image"></slot></section><slot name="navigation"></slot></header>',
  bodyHtml: '<main><slot name="content"></slot></main>',
  footerHtml: '<footer class="site-footer"><slot name="content"></slot></footer>',
  css: "",
};
export const defaultAppearance = { accent: "sage" as const, layout: "standard" as const, imageUrl: "" };
export type ThemePart = "header" | "body" | "footer";
export const themeHtmlKey = (part: ThemePart) => `${part}Html` as const;
/** Empty part CSS means "unset"; keeping "" would look like a change to an identical part. */
export function compactTheme<T extends Partial<Theme>>(theme: T): T {
  const next = { ...theme };
  if (!next.headerCss) delete next.headerCss;
  if (!next.footerCss) delete next.footerCss;
  return next;
}
/** The eyebrow belongs to the standard header fragment; a custom fragment replaces it. */
export const showsHeaderEyebrow = (theme?: Theme) => !theme || theme.headerHtml === standardTheme.headerHtml;
export const hasThemeFrame = (theme?: Theme) => !!theme && (theme.bodyHtml !== standardTheme.bodyHtml || theme.css !== "");
