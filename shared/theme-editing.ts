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
export const hasThemeFrame = (theme?: Theme) => !!theme && (theme.bodyHtml !== standardTheme.bodyHtml || theme.css !== "");
