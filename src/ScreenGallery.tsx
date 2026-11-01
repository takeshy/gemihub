import { tr } from "../shared/i18n";
import React, { useEffect, useMemo, useState } from "react";
import { PublicShop, type Session } from "./App";
import { ApiProvider, useApi } from "./api";
import { createPreviewClient, sampleFixtures, type Fixtures } from "./local-preview";
import type { ShopConfig } from "../server/domain";
import { postKey } from "../server/post-domain";

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
export function PreviewSurface({ config, shopId, screen, fixtures: suppliedFixtures, onScreenChange }: { config: ShopConfig; shopId: string; screen: PreviewScreen; fixtures?: Fixtures; onScreenChange?: (screen:PreviewLocation)=>void }) {
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
    <ApiProvider value={client}><PublicShop key={JSON.stringify(route || screen)} session={session} slug="local-preview" initialPane={route?.pane || screen.pane || "mine"} category={route ? route.category : screen.category} articleKey={route ? route.articleKey : screen.article && article ? postKey(article) : undefined} pageSlug={route ? route.pageSlug : screen.pageSlug} busy={false} run={async fn => { setError(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} notify={setNotice} navigate={href => {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/^\/s\/local-preview\/(blogs|announcements|pages)(?:\/([^/]+))?$/);
      if (match?.[1] === "pages") setRoute({ pageSlug: match[2] });
      else if (match) setRoute({ category: match[1] as "blogs" | "announcements", articleKey: match[2] });
      else setRoute({ pane: url.searchParams.get("pane") || "mine" });
    }} onPaneChange={pane => setRoute({ pane })} /></ApiProvider>
  </div>;
}

export function ScreenGallery({ config, shopId }: { config: ShopConfig; shopId: string }) {
  return <section className="screen-gallery" aria-label={tr("用意する画面の一覧")}><h4>{tr("用意する画面")}</h4><p className="small muted">{tr("サムネイルは仮の内容で表示しています。スタッフや料金などは、仮公開後に各メニューで設定できます。")}</p>
    <div className="screen-gallery-grid">{previewScreens(config).map(screen => <figure key={screen.id}>
      <div className="screen-thumbnail" inert aria-hidden="true"><div className="screen-thumbnail-content"><PreviewSurface config={config} shopId={shopId} screen={screen} /></div></div>
      <figcaption><strong>{screen.name}</strong><span>{screen.description}</span></figcaption>
    </figure>)}</div>
  </section>;
}
