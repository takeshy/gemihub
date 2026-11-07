import { storefrontText } from "./storefront-copy.ts";
import type { ShopConfig } from "../server/domain.ts";
import { articleKinds } from "./article-features.ts";

/** The menu supplied by the application to the theme's navigation slot. */
export function navigationItems(config: ShopConfig) {
  return [
    { href: "/", label: storefrontText(config, "navMine") },
    { href: "/?pane=reserve", label: storefrontText(config, "navReserve") },
    { href: "/?pane=about", label: storefrontText(config, "navAbout") },
    { href: "/?pane=contact", label: storefrontText(config, "navContact") },
    ...articleKinds(config).map(kind => ({ href: `/${kind}`, label: storefrontText(config, kind === "blogs" ? "navBlogs" : "navAnnouncements") })),
    ...config.pages.map(page => ({ href: `/pages/${page.slug}`, label: page.navigationLabel })),
  ];
}
