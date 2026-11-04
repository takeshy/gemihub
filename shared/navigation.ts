import type { ShopConfig } from "../server/domain.ts";
import { articleKinds } from "./article-features.ts";
import { tr } from "./i18n.ts";

/** The menu supplied by the application to the theme's navigation slot. */
export function navigationItems(config: ShopConfig) {
  return [
    { href: "/", label: tr("マイページ") },
    { href: "/?pane=reserve", label: tr("ご予約") },
    { href: "/?pane=about", label: tr("お店のこと") },
    { href: "/?pane=contact", label: tr("お問い合わせ") },
    ...articleKinds(config).map(kind => ({ href: `/${kind}`, label: kind === "blogs" ? tr("ブログ") : tr("お知らせ") })),
    ...config.pages.map(page => ({ href: `/pages/${page.slug}`, label: page.navigationLabel })),
  ];
}
