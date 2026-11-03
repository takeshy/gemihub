import { tr } from "../shared/i18n.ts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteHeader, SiteFooter } from "../src/SiteChrome.tsx";
import type { ShopConfig } from "./domain.ts";
import { articleKinds } from "../shared/article-features.ts";
export function renderChrome(config: ShopConfig, part: "header" | "footer", resolvedImages?: Record<string, string>) {
  return renderToStaticMarkup(part === "header" ? <SiteHeader config={config} resolvedImages={resolvedImages}><nav className="public-nav"><a href="/">{tr("マイページ")}</a><a href="/?pane=reserve">{tr("ご予約")}</a><a href="/?pane=about">{tr("お店のこと")}</a><a href="/?pane=contact">{tr("お問い合わせ")}</a>{articleKinds(config).map(kind=><a key={kind} href={`/${kind}`}>{kind==="blogs"?tr("ブログ"):tr("お知らせ")}</a>)}{config.pages.map(p => <a key={p.id} href={`/pages/${p.slug}`}>{p.navigationLabel}</a>)}</nav></SiteHeader> : <SiteFooter config={config} resolvedImages={resolvedImages} />);
}
