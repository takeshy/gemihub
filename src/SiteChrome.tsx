import React from "react";
import Markdown from "react-markdown";
import type { ShopConfig } from "../server/domain";
const days = ["日", "月", "火", "水", "木", "金", "土"];
export function SiteHeader({ config: c, children }: { config: ShopConfig; children?: React.ReactNode }) {
  const image = c.header.imageUrl || c.appearance?.imageUrl;
  return <header className="site-header"><section className="salon-hero">
    <span className="eyebrow">A LITTLE MOMENT, JUST FOR YOU.</span>
    <h1>{c.header.title || c.name}</h1><p>{c.header.subtitle || c.description}</p>
    {c.header.showDetails && <div className="salon-details"><span>◷ {c.hours.start} – {c.hours.end}</span><span>定休日：{c.hours.closedWeekdays.map(d => `${days[d]}曜`).join("・") || "なし"}</span></div>}
    {image ? <img className="salon-image" src={image} alt="お店の紹介画像" /> : <span className="hero-flower">✳</span>}
  </section>{c.header.showNavigation && children}</header>;
}
export function SiteFooter({ config: c }: { config: ShopConfig }) {
  return <footer className={`site-footer site-footer-${c.footer.alignment}`}><Markdown skipHtml disallowedElements={["img", "iframe", "script", "style", "form", "input"]}>{c.footer.text || `© ${c.name}`}</Markdown></footer>;
}
export function ChromeEditor({ config, part, onChange }: { config: ShopConfig; part: "header" | "footer"; onChange: (config: ShopConfig) => void }) {
  return part === "header" ? <div className="chrome-editor">
    <label>ヘッダーの見出し<input value={config.header.title} placeholder={config.name} onChange={e => onChange({ ...config, header: { ...config.header, title: e.target.value } })} /></label>
    <label>ヘッダーの紹介文<textarea value={config.header.subtitle} placeholder={config.description} onChange={e => onChange({ ...config, header: { ...config.header, subtitle: e.target.value } })} /></label>
    <label>ヘッダー画像のURL（HTTPS）<input type="url" value={config.header.imageUrl} onChange={e => onChange({ ...config, header: { ...config.header, imageUrl: e.target.value } })} /></label>
    <label><input type="checkbox" checked={config.header.showDetails} onChange={e => onChange({ ...config, header: { ...config.header, showDetails: e.target.checked } })} />営業時間・定休日を表示</label>
    <label><input type="checkbox" checked={config.header.showNavigation} onChange={e => onChange({ ...config, header: { ...config.header, showNavigation: e.target.checked } })} />ナビゲーションを表示</label>
  </div> : <div className="chrome-editor">
    <label>フッターの本文<textarea rows={5} value={config.footer.text} placeholder={`© ${config.name}`} onChange={e => onChange({ ...config, footer: { ...config.footer, text: e.target.value } })} /></label>
    <label>フッターの配置<select value={config.footer.alignment} onChange={e => onChange({ ...config, footer: { ...config.footer, alignment: e.target.value as "left" | "center" } })}><option value="center">中央</option><option value="left">左揃え</option></select></label>
  </div>;
}

export function ChromePreview({ config, part }: { config: ShopConfig; part: "header" | "footer" }) {
  return <div className={`public-shop accent-${config.appearance?.accent || "sage"}`}>{part === "header" ? <SiteHeader config={config}><nav className="public-nav"><span>ご予約</span><span>お店のこと</span><span>マイページ</span><span>お問い合わせ</span>{config.pages.map(page => <span key={page.id}>{page.navigationLabel}</span>)}</nav></SiteHeader> : <SiteFooter config={config} />}</div>;
}
