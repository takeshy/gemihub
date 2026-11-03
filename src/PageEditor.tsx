import { tr } from "../shared/i18n";
import React, { useRef, useState } from "react";
import type { ShopPage } from "../server/pages";
import { ImagePicker } from "./ImageLibrary";
export function PageEditor({ page, onChange, onDelete, shopId }: { page: ShopPage; onChange: (page: ShopPage) => void; onDelete: () => void; shopId?: string }) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [insertKey, setInsertKey] = useState(0);
  // Insert a managed image as the checked <img data-image-id> form at the caret (or the end).
  function insertImage(imageId: string) {
    const area = bodyRef.current;
    const start = area?.selectionStart ?? page.body.length, end = area?.selectionEnd ?? start;
    const tag = `<img data-image-id="${imageId}" alt="">`;
    onChange({ ...page, body: page.body.slice(0, start) + tag + page.body.slice(end) });
    setInsertKey(value => value + 1);
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + tag.length, start + tag.length); });
  }
  return <div className="page-editor">
    <h3>{tr("このページを編集")}</h3>
    <label>{tr("ページのタイトル")}<input value={page.title} onChange={e => onChange({ ...page, title: e.target.value })} /></label>
    <label>{tr("メニューに表示する名前")}<input value={page.navigationLabel} onChange={e => onChange({ ...page, navigationLabel: e.target.value })} /></label>
    <label>{tr("ページのアドレス")}<input value={page.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={e => onChange({ ...page, slug: e.target.value })} /></label>
    <p className="small muted">{tr("半角の英小文字・数字・ハイフンを使えます。公開後に変えるとページのURLも変わります。")}</p>
    <label>{tr("ページ本文（HTML）")}<textarea ref={bodyRef} rows={16} spellCheck={false} className="code-input" value={page.body} onChange={e => onChange({ ...page, body: e.target.value })} /></label>
    {shopId && <div className="page-editor-insert"><ImagePicker key={insertKey} shopId={shopId} preview={false} change={imageId => { if (imageId) insertImage(imageId); }} /><span className="small muted">{tr("選んだ画像をカーソルの位置に入れます。")}</span></div>}
    <label>{tr("このページの CSS")}<textarea rows={10} spellCheck={false} className="code-input" value={page.css || ""} onChange={e => onChange({ ...page, css: e.target.value })} /></label>
    <p className="small muted">{tr("HTML とこのページだけに効く CSS（アニメーションも可）を使えます。スクリプト、onclick などのイベント属性、フォーム、iframe などの埋め込み、外部の CSS の読み込みは使えません。お店の画像は <img data-image-id=\"画像のID\" alt=\"説明\"> で入れます。")}</p>
    {shopId && <ImagePicker shopId={shopId} value={page.imageId} change={imageId => onChange({ ...page, imageId, imageUrl: imageId ? "" : page.imageUrl })} />}
    <label>{tr("ページの画像（HTTPS URL）")}<input type="url" value={page.imageUrl} onChange={e => onChange({ ...page, imageUrl: e.target.value, imageId: undefined })} /></label>
    <label>{tr("ページの配置")}<select value={page.layout} onChange={e => onChange({ ...page, layout: e.target.value as ShopPage["layout"] })}><option value="standard">{tr("ゆったり")}</option><option value="compact">{tr("コンパクト")}</option></select></label>
    <button onClick={onDelete}>{tr("このページを削除する")}</button>
  </div>;
}
