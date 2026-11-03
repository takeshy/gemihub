import { tr } from "../shared/i18n";
import React from "react";
import Markdown from "react-markdown";
import type { ShopConfig } from "../server/domain";
import { MenuImage } from "./MenuImage";
import { ImagePicker } from "./ImageLibrary";
const days = () => [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];
export function SiteHeader({ config: c, children, actions, imageBase, imageSuffix }: { config: ShopConfig; children?: React.ReactNode; actions?: React.ReactNode; imageBase?: string; imageSuffix?: string }) {
  const image = c.header.imageUrl || c.appearance?.imageUrl;
  return <header className="site-header">{actions}<section className="salon-hero">
    <span className="eyebrow">A LITTLE MOMENT, JUST FOR YOU.</span>
    <h1>{c.header.title || c.name}</h1><p>{c.header.subtitle || c.description}</p>
    {c.header.showDetails && <div className="salon-details"><span>◷ {c.hours.start} – {c.hours.end}</span><span>{tr("定休日：")}{c.hours.closedWeekdays.map(d => tr("{0}曜", days()[d])).join("・") || tr("なし")}</span></div>}
    {c.header.imageId && imageBase ? <MenuImage imageId={c.header.imageId} imageBase={imageBase} suffix={imageSuffix} name={tr("お店の紹介")} className="managed-hero-image" /> : image ? <img className="salon-image" src={image} alt={tr("お店の紹介画像")} /> : <span className="hero-flower">✳</span>}
  </section>{c.header.showNavigation && children}</header>;
}
export function SiteFooter({ config: c }: { config: ShopConfig }) {
  return <footer className={`site-footer site-footer-${c.footer.alignment}`}><Markdown skipHtml disallowedElements={["img", "iframe", "script", "style", "form", "input"]}>{c.footer.text || `© ${c.name}`}</Markdown></footer>;
}
export function ChromeEditor({ config, part, onChange, shopId }: { config: ShopConfig; part: "header" | "footer"; onChange: (config: ShopConfig) => void; shopId?: string }) {
  return part === "header" ? <div className="chrome-editor">
    <label>{tr("ヘッダーの見出し")}<input value={config.header.title} placeholder={config.name} onChange={e => onChange({ ...config, header: { ...config.header, title: e.target.value } })} /></label>
    <label>{tr("ヘッダーの紹介文")}<textarea value={config.header.subtitle} placeholder={config.description} onChange={e => onChange({ ...config, header: { ...config.header, subtitle: e.target.value } })} /></label>
    {shopId && <ImagePicker shopId={shopId} value={config.header.imageId} change={imageId => onChange({ ...config, header: { ...config.header, imageId, imageUrl: imageId ? "" : config.header.imageUrl } })} />}
    <label>{tr("ヘッダー画像のURL（HTTPS）")}<input type="url" value={config.header.imageUrl} onChange={e => onChange({ ...config, header: { ...config.header, imageUrl: e.target.value, imageId: undefined } })} /></label>
    <label><input type="checkbox" checked={config.header.showDetails} onChange={e => onChange({ ...config, header: { ...config.header, showDetails: e.target.checked } })} />{tr("営業時間・定休日を表示")}</label>
    <label><input type="checkbox" checked={config.header.showNavigation} onChange={e => onChange({ ...config, header: { ...config.header, showNavigation: e.target.checked } })} />{tr("ナビゲーションを表示")}</label>
  </div> : <div className="chrome-editor">
    <label>{tr("フッターの本文")}<textarea rows={5} value={config.footer.text} placeholder={`© ${config.name}`} onChange={e => onChange({ ...config, footer: { ...config.footer, text: e.target.value } })} /></label>
    <label>{tr("フッターの配置")}<select value={config.footer.alignment} onChange={e => onChange({ ...config, footer: { ...config.footer, alignment: e.target.value as "left" | "center" } })}><option value="center">{tr("中央")}</option><option value="left">{tr("左揃え")}</option></select></label>
  </div>;
}

export function ChromePreview({ config, part, imageBase }: { config: ShopConfig; part: "header" | "footer"; imageBase?: string }) {
  return <div className={`public-shop accent-${config.appearance?.accent || "sage"}`}>{part === "header" ? <SiteHeader config={config} imageBase={imageBase}><nav className="public-nav"><span>{tr("マイページ")}</span><span>{tr("ご予約")}</span><span>{tr("お店のこと")}</span><span>{tr("お問い合わせ")}</span><span>{tr("ブログ")}</span><span>{tr("お知らせ")}</span>{config.pages.map(page => <span key={page.id}>{page.navigationLabel}</span>)}</nav></SiteHeader> : <SiteFooter config={config} />}</div>;
}
