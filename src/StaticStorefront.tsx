import { storefrontText } from "../shared/storefront-copy";
import React from "react";
import { SiteHeader, SiteFooter, ThemeBody } from "./SiteChrome";
import { hasThemeFrame } from "../shared/theme-editing";
import { CustomPage } from "./CustomPage";
import { PostContent } from "./PostContent";
import { ShopAbout } from "./ShopAbout";
import { LanguageLinks } from "./LanguageSwitcher";
import { navigationItems } from "../shared/navigation";
import { getLocale, tr } from "../shared/i18n";
import type { ShopConfig } from "../server/domain";
import { postKey, postLabel, postPath, type PublicPost, type PostCategory } from "../server/post-domain";
import type { ShopPage } from "../server/pages";

export type StaticStorefrontView =
  | { kind: "home"; posts: PublicPost[] }
  | { kind: "archive"; category: PostCategory; posts: PublicPost[] }
  | { kind: "article"; post: PublicPost }
  | { kind: "page"; page: ShopPage };
export function staticViewPath(view: StaticStorefrontView) {
  return view.kind === "home" ? "" : view.kind === "page" ? `pages/${view.page.slug}` : view.kind === "archive" ? view.category : `${view.post.category}/${postKey(view.post)}`;
}
const link = (path: string) => `${path}${path.includes("?") ? "&" : "?"}lang=${getLocale()}`;

function Navigation({ config: c, base }: { config: ShopConfig; base: string }) {
  return <nav className="public-nav">
    {navigationItems(c).map(item => {
      const home = base || "/";
      const href = item.href === "/" ? home : item.href.startsWith("/?") ? `${home}${item.href.slice(1)}` : `${base}${item.href}`;
      return <a key={item.href} href={link(href)}>{item.label}</a>;
    })}
  </nav>;
}
function PostList({ posts, base }: { posts: PublicPost[]; base: string }) {
  return <ul>{posts.map(post => <li key={post.id}><time dateTime={post.date}>{post.date}</time> <a href={link(postPath(base, post))}>{post.title}</a></li>)}</ul>;
}
/** The same public markup is generated at publication and shown in Storybook; no effects or API calls. */
export function StaticStorefront({ config: c, view, base, provisional = false, imageSources = {} }: { config: ShopConfig; view: StaticStorefrontView; base: string; provisional?: boolean; imageSources?: Record<string, string> }) {
  const path = staticViewPath(view);
  const resolved = imageSources;
  let content: React.ReactNode;
  if (view.kind === "home") content = <><ShopAbout config={c} imageSources={imageSources} />{!!view.posts.length && <section className="recent-posts"><h2>{storefrontText(c, "recentPosts")}</h2><PostList posts={view.posts.slice(0, 5)} base={base} /></section>}</>;
  else if (view.kind === "archive") content = <section className="panel post-archive"><h2>{storefrontText(c, view.category === "blogs" ? "navBlogs" : "navAnnouncements")}</h2><PostList posts={view.posts.filter(post => post.category === view.category)} base={base} /></section>;
  else if (view.kind === "article") content = <div className="panel article-page"><a href={link(`${base}/${view.post.category}`)}>{postLabel(view.post.category)}{tr("一覧")}</a><PostContent post={view.post} imageSources={imageSources} /></div>;
  else content = <CustomPage page={view.page} resolvedImages={resolved} />;
  return <>
    <LanguageLinks href={`${base}${path ? `/${path}` : ""}`} />
    <main><div className={`public-shop accent-${c.appearance?.accent || "sage"} layout-${c.appearance?.layout || "standard"}${hasThemeFrame(c.appearance?.theme) ? " custom-theme" : ""}`}>
      {provisional && <div className="preview-banner">{tr("仮公開中 · このページを用意したGoogleアカウントでログインした本人だけが表示できます。")}</div>}
      <SiteHeader config={c} resolvedImages={resolved}><Navigation config={c} base={base} /></SiteHeader>
      <ThemeBody config={c} resolvedImages={resolved}><section className="public-auth"><a className="button primary" href={`${link(`${base || "/"}?pane=mine`)}#email-login`}>{tr("会員登録・ログイン")}</a></section>{content}</ThemeBody>
      <SiteFooter config={c} resolvedImages={resolved} />
    </div></main>
  </>;
}
