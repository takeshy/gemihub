import { tr } from "../shared/i18n";
import React, { useEffect, useMemo, useState } from "react";
import { PublicShop, type Session } from "./App";
import { ApiProvider, useApi } from "./api";
import { createPreviewClient, sampleFixtures, type Fixtures } from "./local-preview";
import type { ShopConfig } from "../server/domain";
import { postKey } from "../server/post-domain";
import { ChromePreview } from "./SiteChrome";

export type PreviewScreen = { id: string; name: string; description: string; pane?: string; category?: "blogs" | "announcements"; article?: boolean; pageSlug?: string };
export function previewScreens(config: ShopConfig): PreviewScreen[] {
  return [
    { id: "reserve", name: tr("予約"), description: tr("メニュー・担当者・日時を選んで予約"), pane: "reserve" },
    { id: "about", name: tr("お店のこと"), description: tr("お店の紹介・アクセス・メニュー"), pane: "about" },
    { id: "mine", name: tr("マイページ"), description: tr("自分の予約を確認・キャンセル"), pane: "mine" },
    { id: "contact", name: tr("お問い合わせ"), description: tr("お店に質問やメッセージを送る"), pane: "contact" },
    { id: "blogs", name: tr("ブログ一覧"), description: tr("お店からのお便りを一覧で見る"), category: "blogs" },
    { id: "blogs:article", name: tr("ブログ記事"), description: tr("お店のお便りを読む"), category: "blogs", article: true },
    { id: "announcements", name: tr("お知らせ一覧"), description: tr("営業日などの案内を一覧で見る"), category: "announcements" },
    { id: "announcements:article", name: tr("お知らせ記事"), description: tr("お店からの案内を読む"), category: "announcements", article: true },
    ...config.pages.map(page => ({ id: `page:${page.id}`, name: page.title, description: tr("追加するページ"), pageSlug: page.slug })),
  ];
}

export type PreviewLocation = { id: string; name: string; articleKey?: string };
export function PreviewSurface({ config, shopId, screen, fixtures: suppliedFixtures, onScreenChange, hideHeader = false, hideFooter = false }: { config: ShopConfig; shopId: string; screen: PreviewScreen; fixtures?: Fixtures; onScreenChange?: (screen:PreviewLocation)=>void; hideHeader?: boolean; hideFooter?: boolean }) {
  const api = useApi();
  const fixtures = useMemo(() => suppliedFixtures || sampleFixtures(config), [config, suppliedFixtures]);
  const client = useMemo(() => createPreviewClient(config, fixtures, shopId, id => api(`/api/shops/${shopId}/menu-images/${id}`)), [config, fixtures, shopId, api]);
  const [route, setRoute] = useState<{ pane?: string; category?: "blogs" | "announcements"; articleKey?: string; pageSlug?: string }>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const article = fixtures.posts.find(post => post.category === screen.category);
  const currentId=route ? route.pageSlug ? `page:${config.pages.find(page=>page.slug===route.pageSlug)?.id}` : route.category ? `${route.category}${route.articleKey?":article":""}` : route.pane || "about" : screen.id;
  const currentName=previewScreens(config).find(item=>item.id===currentId)?.name || screen.name;
  const currentArticleKey=route ? route.articleKey : screen.article&&article ? postKey(article) : undefined;
  useEffect(()=>{onScreenChange?.({id:currentId,name:currentName,articleKey:currentArticleKey});},[currentId,currentName,currentArticleKey,onScreenChange]);
  const session: Session = { demo: false, user: { role: "customer", email: "sample@example.com", name: fixtures.customerName, shopId } };
  if (!route && screen.article && !article) return <p className="panel">{tr("まだ記事がありません。ブログ・お知らせのメニューで記事を作成すると、ここで表示を確認できます。")}</p>;
  return <div className="preview-surface">
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}{tr("（練習用です。実際の予約やメールには反映しません。）")}</p>}
    <ApiProvider value={client}><PublicShop key={JSON.stringify(route || screen)} hideHeader={hideHeader} hideFooter={hideFooter} session={session} slug="local-preview" initialPane={route?.pane || screen.pane || "mine"} category={route ? route.category : screen.category} articleKey={route ? route.articleKey : screen.article && article ? postKey(article) : undefined} pageSlug={route ? route.pageSlug : screen.pageSlug} busy={false} run={async fn => { setError(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} notify={setNotice} navigate={href => {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/^\/s\/local-preview\/(blogs|announcements|pages)(?:\/([^/]+))?$/);
      if (match?.[1] === "pages") setRoute({ pageSlug: match[2] });
      else if (match) setRoute({ category: match[1] as "blogs" | "announcements", articleKey: match[2] });
      else setRoute({ pane: url.searchParams.get("pane") || "mine" });
    }} onPaneChange={pane => setRoute({ pane })} /></ApiProvider>
  </div>;
}

/**
 * The first-publication review: the screens that will be prepared, by name only, and a sample of
 * the theme (header, footer, colours and layout) with placeholder content instead of screen captures.
 */
export function ScreenGallery({ config, shopId }: { config: ShopConfig; shopId: string }) {
  const accent = config.appearance?.accent || "sage";
  const layout = config.appearance?.layout || "standard";
  return <section className="screen-gallery" aria-label={tr("用意する画面の一覧")}>
    <h4>{tr("用意する画面")}</h4>
    <ul className="screen-name-list">{previewScreens(config).map(screen => <li key={screen.id}><strong>{screen.name}</strong><span>{screen.description}</span></li>)}</ul>
    <p className="small muted">{tr("全画面に共通のヘッダー・フッターが付きます。")}</p>
    <h4>{tr("ページの雰囲気")}</h4>
    <p className="small muted">{tr("色・配置・ヘッダー・フッターの見本です。中身は仮の表示です。")}</p>
    <div className="theme-preview" inert aria-hidden="true">
      <ChromePreview config={config} part="header" imageBase={`/api/shops/${shopId}/images`} />
      <div className={`public-shop accent-${accent} layout-${layout}`}><div className="theme-placeholder"><span>{tr("ここに各種画面の内容が入ります")}</span></div></div>
      <ChromePreview config={config} part="footer" imageBase={`/api/shops/${shopId}/images`} />
    </div>
  </section>;
}
