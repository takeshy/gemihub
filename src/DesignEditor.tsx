import { tr } from "../shared/i18n";
import React, { useRef, useState } from "react";
import type { ShopConfig } from "../server/domain";
import { themeSchema, type Theme } from "../shared/presentation";
import { screenDesignError, screenSlots, screenStarter, type ScreenId } from "../shared/screens";
import { compactTheme, defaultAppearance, standardTheme, themeHtmlKey, type ThemePart } from "../shared/theme-editing";
import { ImagePicker } from "./ImageLibrary";

// HTML/CSS editors for built-in screens and the shared theme. Text stays local while it is being
// written; "Apply to preview" validates it with the same checks as publication.

const slotHelp: Record<string, () => string> = {
  booking: () => tr("予約フォーム（メニュー・担当・日時・お支払い）"),
  mypage: () => tr("マイページ（会員情報・予約の確認とキャンセル）"),
  news: () => tr("最新のブログ・お知らせ"),
  form: () => tr("お問い合わせフォーム"),
  menus: () => tr("メニューと料金"),
  staff: () => tr("スタッフ"),
  access: () => tr("住所と地図"),
  hours: () => tr("営業時間と定休日"),
  title: () => tr("店名"),
  subtitle: () => tr("紹介文"),
  details: () => tr("営業時間などの補足"),
  image: () => tr("紹介画像"),
  navigation: () => tr("お客様向けメニュー"),
  content: () => tr("各画面の内容（フッターではフッターの文章）"),
};

/** A code field with an image button that inserts a managed image at the caret. */
function CodeArea({ label, value, onChange, rows, shopId }: { label: string; value: string; onChange: (value: string) => void; rows: number; shopId?: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [pickerKey, setPickerKey] = useState(0);
  function insert(imageId: string) {
    const start = area.current?.selectionStart ?? value.length, end = area.current?.selectionEnd ?? start;
    const tag = `<img data-image-id="${imageId}" alt="">`;
    onChange(value.slice(0, start) + tag + value.slice(end));
    setPickerKey(key => key + 1);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(start + tag.length, start + tag.length); });
  }
  return <div className="design-code">
    <label>{label}<textarea ref={area} rows={rows} spellCheck={false} className="code-input" value={value} onChange={event => onChange(event.target.value)} /></label>
    {shopId && <div className="page-editor-insert"><ImagePicker key={pickerKey} shopId={shopId} preview={false} change={imageId => { if (imageId) insert(imageId); }} /><span className="small muted">{tr("選んだ画像をカーソルの位置に入れます。")}</span></div>}
  </div>;
}
function SlotList({ allowed, required }: { allowed: readonly string[]; required: readonly string[] }) {
  return <ul className="design-slots">{allowed.map(slot => <li key={slot}><code>{`<slot name="${slot}"></slot>`}</code><span>{slotHelp[slot]?.() || slot}{required.includes(slot) && <b>{tr("（必須）")}</b>}</span></li>)}</ul>;
}
const rules = () => tr("使えないもの：スクリプト、onclick などのイベント属性、フォーム・入力欄・ボタン、iframe などの埋め込み、外部の CSS・@import・CSS の url()。お店の画像は <img data-image-id=\"画像のID\" alt=\"説明\"> で入れます。");

/** One built-in screen's layout. The screen's working parts are slots that must stay in place. */
export function ScreenDesignEditor({ config, screen, shopId, onChange }: { config: ShopConfig; screen: ScreenId; shopId: string; onChange: (config: ShopConfig) => void }) {
  const saved = config.screens?.[screen];
  const [html, setHtml] = useState(saved?.html || "");
  const [css, setCss] = useState(saved?.css || "");
  const [error, setError] = useState("");
  const { allowed, required } = screenSlots[screen];
  const apply = (design?: { html: string; css: string }) => {
    if (design) { const problem = screenDesignError(screen, design); if (problem) { setError(problem); return; } }
    const screens = { ...config.screens };
    if (design) screens[screen] = design; else delete screens[screen];
    setError("");
    onChange({ ...config, screens: Object.keys(screens).length ? screens : undefined });
  };
  if (!saved && !html) return <div className="design-editor">
    <p>{tr("この画面は標準の表示です。HTML で見出し・文章・写真・配置を自由に作れます。予約などの機能の部分はそのまま差し込まれます。")}</p>
    <button type="button" onClick={() => { const starter = screenStarter(screen); setHtml(starter.html); setCss(starter.css); }}>{tr("この画面を HTML で作る")}</button>
  </div>;
  return <div className="design-editor">
    <p className="small muted">{tr("次の差し込み口を HTML の好きな位置に置きます。")}</p>
    <SlotList allowed={allowed} required={required} />
    <CodeArea label={tr("この画面の HTML")} value={html} onChange={setHtml} rows={14} shopId={shopId} />
    <CodeArea label={tr("この画面の CSS")} value={css} onChange={setCss} rows={8} />
    <p className="small muted">{rules()}</p>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="actions">
      {saved && <button type="button" onClick={() => { if (window.confirm(tr("この画面の HTML をやめて標準の表示に戻しますか？"))) { setHtml(""); setCss(""); apply(undefined); } }}>{tr("標準の表示に戻す")}</button>}
      <button type="button" className="primary" onClick={() => apply({ html, css })}>{tr("プレビューに反映")}</button>
    </div>
  </div>;
}

/** Each part edits its own HTML/CSS. The frame editor owns the common stylesheet. */
export function ThemeDesignEditor({ config, part, shopId, onChange, openFrame }: { config: ShopConfig; part: ThemePart; shopId: string; onChange: (config: ShopConfig) => void; openFrame?: () => void }) {
  const saved = config.appearance?.theme;
  const base = saved || standardTheme;
  const [html, setHtml] = useState(base[themeHtmlKey(part)]);
  const [css, setCss] = useState(part === "body" ? base.css : base[`${part}Css`] || "");
  const [error, setError] = useState("");
  function apply(nextHtml = html, nextCss = css) {
    const theme: Theme = { ...base, [themeHtmlKey(part)]: nextHtml, ...(part === "body" ? { css: nextCss } : { [`${part}Css`]: nextCss }) };
    const parsed = themeSchema.safeParse(compactTheme(theme));
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(" / ")); return; }
    setError(""); onChange({ ...config, appearance: { ...(config.appearance || defaultAppearance), theme: parsed.data } });
  }
  return <div className="design-editor">
    <p className="small muted">{part === "body" ? tr("全画面に共通する枠の HTML と、ヘッダー・フッターにも使う共通 CSS を編集します。") : tr("このパーツの HTML と専用 CSS を編集します。共通 CSS は「全体の枠」で編集できます。")}</p>
    <SlotList allowed={part === "header" ? ["title", "subtitle", "details", "image", "navigation"] : ["content"]} required={part === "header" ? ["navigation"] : ["content"]} />
    <CodeArea label={part === "header" ? tr("ヘッダーの HTML") : part === "footer" ? tr("フッターの HTML") : tr("全体の枠の HTML")} value={html} onChange={setHtml} rows={part === "header" ? 8 : 5} shopId={shopId} />
    <CodeArea label={part === "body" ? tr("全体の CSS（ヘッダー・枠・フッター共通）") : part === "header" ? tr("ヘッダー専用の CSS") : tr("フッター専用の CSS")} value={css} onChange={setCss} rows={12} />
    {part !== "body" && openFrame && <button type="button" className="text-button" onClick={openFrame}>{tr("全体の枠・共通 CSS を編集")}</button>}
    <p className="small muted">{rules()}</p>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="actions">
      {saved && <button type="button" onClick={() => {
        if (!window.confirm(part === "body" ? tr("枠の HTML と共通 CSS を標準に戻しますか？ヘッダー・フッターの HTML は残ります。") : tr("このパーツの HTML と専用 CSS を標準に戻しますか？他のパーツと共通 CSS は残ります。"))) return;
        setHtml(standardTheme[themeHtmlKey(part)]); setCss("");
        apply(standardTheme[themeHtmlKey(part)], "");
      }}>{tr("標準の表示に戻す")}</button>}
      <button type="button" className="primary" onClick={() => apply()}>{tr("プレビューに反映")}</button>
    </div>
  </div>;
}
