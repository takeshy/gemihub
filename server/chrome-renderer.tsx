import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteHeader, SiteFooter } from "../src/SiteChrome.tsx";
import type { ShopConfig } from "./domain.ts";
export function renderChrome(config: ShopConfig, part: "header" | "footer") {
  return renderToStaticMarkup(part === "header" ? <SiteHeader config={config}><nav className="public-nav"><a href="/">予約</a>{config.pages.map(p => <a key={p.id} href={`/pages/${p.slug}`}>{p.navigationLabel}</a>)}</nav></SiteHeader> : <SiteFooter config={config} />);
}
