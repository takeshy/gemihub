import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteHeader, SiteFooter } from "../src/SiteChrome.tsx";
import type { ShopConfig } from "./domain.ts";
import { navigationItems } from "../shared/navigation.ts";
export function renderChrome(config: ShopConfig, part: "header" | "footer", resolvedImages?: Record<string, string>) {
  return renderToStaticMarkup(part === "header" ? <SiteHeader config={config} resolvedImages={resolvedImages}><nav className="public-nav">{navigationItems(config).map(item => <a key={item.href} href={item.href}>{item.label}</a>)}</nav></SiteHeader> : <SiteFooter config={config} resolvedImages={resolvedImages} />);
}
