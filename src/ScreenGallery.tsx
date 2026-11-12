import { tr } from "../shared/i18n";
import React, { useEffect, useMemo, useState } from "react";
import { PublicShop, type Session } from "./App";
import { ApiProvider, useApi } from "./api";
import { createPreviewClient, sampleFixtures, type Fixtures } from "./local-preview";
import type { ShopConfig } from "../server/domain";
import { postKey } from "../server/post-domain";
import { ChromePreview, ThemeBody } from "./SiteChrome";
import { hasThemeFrame } from "../shared/theme-editing";
import { articleKinds } from "../shared/article-features";
import { same, scopedSource } from "../server/pages";

export type PreviewScreen = { id: string; name: string; description: string; pane?: string; category?: "blogs" | "announcements"; article?: boolean; articleKey?: string; pageSlug?: string };
export function previewScreens(config: ShopConfig): PreviewScreen[] {
  return ([
    { id: "reserve", name: tr("予約"), description: tr("メニュー・担当者・日時を選んで予約"), pane: "reserve" },
    { id: "about", name: tr("お店のこと"), description: tr("お店の紹介・アクセス・メニュー"), pane: "about" },
    { id: "mine", name: tr("マイページ"), description: tr("自分の予約を確認・キャンセル"), pane: "mine" },
    { id: "contact", name: tr("お問い合わせ"), description: tr("お店に質問やメッセージを送る"), pane: "contact" },
    { id: "blogs", name: tr("ブログ一覧"), description: tr("お店からのお便りを一覧で見る"), category: "blogs" },
    { id: "blogs:article", name: tr("ブログ記事"), description: tr("お店のお便りを読む"), category: "blogs", article: true },
    { id: "announcements", name: tr("お知らせ一覧"), description: tr("営業日などの案内を一覧で見る"), category: "announcements" },
    { id: "announcements:article", name: tr("お知らせ記事"), description: tr("お店からの案内を読む"), category: "announcements", article: true },
    ...config.pages.map(page => ({ id: `page:${page.id}`, name: page.title, description: tr("追加ページ"), pageSlug: page.slug })),
  ] as PreviewScreen[]).filter(screen => !screen.category || articleKinds(config).includes(screen.category));
}

export type PreviewLocation = { id: string; name: string; articleKey?: string };
export function PreviewSurface({ config, shopId, screen, fixtures: suppliedFixtures, onScreenChange, hideHeader = false, hideFooter = false }: { config: ShopConfig; shopId: string; screen: PreviewScreen; fixtures?: Fixtures; onScreenChange?: (screen:PreviewLocation)=>void; hideHeader?: boolean; hideFooter?: boolean }) {
  const api = useApi();
  const fixtures = useMemo(() => suppliedFixtures || sampleFixtures(config), [config, suppliedFixtures]);
  const client = useMemo(() => createPreviewClient(config, fixtures, shopId, (id, view) => api(`/api/shops/${shopId}/menu-images/${id}${view ? `?view=${view}` : ""}`)), [config, fixtures, shopId, api]);
  const [route, setRoute] = useState<{ pane?: string; category?: "blogs" | "announcements"; articleKey?: string; pageSlug?: string }>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const article = fixtures.posts.find(post => post.category === screen.category && (!screen.articleKey || postKey(post) === screen.articleKey));
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
 * Initial and subsequent proposal reviews share the screen inventory and whole-page sample.
 * Later proposals mark screen changes and compare the design when it changes.
 */
export function ScreenList({ config, previousConfig }: { config: ShopConfig; previousConfig?: ShopConfig }) {
  const screens = previewScreens(config);
  const previousScreens = previousConfig ? previewScreens(previousConfig) : [];
  const removed = previousScreens.filter(screen => !screens.some(next => next.id === screen.id));
  const screenChanged = (id: string) => id.startsWith("page:")
    ? !same(previousConfig?.pages.find(page => `page:${page.id}` === id), config.pages.find(page => `page:${page.id}` === id))
    : !same(previousConfig?.screens?.[id as keyof NonNullable<ShopConfig["screens"]>], config.screens?.[id as keyof NonNullable<ShopConfig["screens"]>]);
  return (
    <ul className="screen-name-list">
      {screens.map(screen => <li key={screen.id}>
        <strong>{screen.name}</strong><span>{screen.description}</span>
        {previousConfig && (!previousScreens.some(previous => previous.id === screen.id)
          ? <b className="screen-change screen-added">{tr("追加")}</b>
          : screenChanged(screen.id) ? <b className="screen-change">{tr("変更")}</b> : null)}
      </li>)}
      {removed.map(screen => <li key={screen.id} className="screen-removed"><strong>{screen.name}</strong><b className="screen-change">{tr("削除")}</b></li>)}
    </ul>
  );
}

export function ScreenGallery({ config, shopId, themeRef, previousConfig }: { config: ShopConfig; shopId: string; themeRef?: React.RefObject<HTMLDivElement | null>; previousConfig?: ShopConfig }) {
  const [before, setBefore] = useState(false);
  const themeChanged = previousConfig && !same(scopedSource(previousConfig, { kind: "theme" }), scopedSource(config, { kind: "theme" }));
  return <section className="screen-gallery" aria-label={tr("用意する画面の一覧")}>
    <h4>{tr("用意する画面")}</h4>
    <ScreenList config={config} previousConfig={previousConfig} />
    <p className="small muted">{tr("全画面に共通のヘッダー・フッターが付きます。")}</p>
    {(!previousConfig || themeChanged) && <>
    <h4>{tr("ページの雰囲気")}</h4>
    {themeChanged && <p className="notice">{tr("ページ全体のデザインに変更があります。変更前と変更後を切り替えて確認できます。")}</p>}
    {previousConfig && <div className="actions" aria-label={tr("ページ全体の比較")}><button type="button" aria-pressed={before} onClick={() => setBefore(true)}>{tr("変更前")}</button><button type="button" aria-pressed={!before} onClick={() => setBefore(false)}>{tr("変更後")}</button></div>}
    <p className="small muted">{tr("色・配置・ヘッダー・フッターの見本です。中身は仮の表示です。")}</p>
    <ThemePreview config={before && previousConfig ? previousConfig : config} shopId={shopId} themeRef={themeRef} />
    </>}
  </section>;
}

function ThemeSamples() {
  return <div className="theme-placeholder">
    <strong>{tr("Dummy（仮の内容）")}</strong>
    <p>{tr("各画面で使う部品の見本です。色・文字・ボタン・入力欄・カードをまとめて確認できます。")}</p>
    <section className="panel theme-sample-card">
      <h2>{tr("見出しの見本")}</h2><p>{tr("本文の見本です。お店の紹介やご案内がここに入ります。")}</p>
      <div className="theme-sample-fields">
        <label className="field">{tr("お名前")}<input readOnly value={tr("サンプルのお客様")} /></label>
        <label className="field">{tr("メニュー")}<select defaultValue="sample"><option value="sample">{tr("サンプルメニュー")}</option></select></label>
        <label className="field">{tr("メッセージ")}<textarea readOnly rows={2} value={tr("メッセージの見本です。")} /></label>
      </div>
      <div className="actions"><button type="button" className="primary">{tr("予約する")}</button><button type="button">{tr("戻る")}</button><button type="button" className="selected">{tr("選択中")}</button><a>{tr("詳しく見る")}</a><svg className="icon" role="img" aria-label={tr("アイコン")} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg></div>
      <p className="notice">{tr("ご案内の見本です。実際の予約や送信は行いません。")}</p>
    </section>
  </div>;
}

/** A complete frame containing inert samples of the real screens' UI elements. */
export function ThemePreview({ config, shopId, themeRef }: { config: ShopConfig; shopId: string; themeRef?: React.RefObject<HTMLDivElement | null> }) {
  const accent = config.appearance?.accent || "sage";
  const layout = config.appearance?.layout || "standard";
  return <div className="theme-preview" ref={themeRef} inert aria-label={tr("ページ全体の見本")}>
      <ChromePreview config={config} part="header" imageBase={`/api/shops/${shopId}/menu-images`} />
      <div className={`public-shop accent-${accent} layout-${layout}${hasThemeFrame(config.appearance?.theme)?" custom-theme":""}`}>
        <ThemeBody config={config} imageBase={`/api/shops/${shopId}/menu-images`}><ThemeSamples /></ThemeBody>
      </div>
      <ChromePreview config={config} part="footer" imageBase={`/api/shops/${shopId}/menu-images`} />
    </div>;
}
