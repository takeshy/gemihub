import React from "react";
import type { ShopPage } from "../server/pages";
import { ImagePicker } from "./ImageLibrary";
export function PageEditor({ page, onChange, onDelete, shopId }: { page: ShopPage; onChange: (page: ShopPage) => void; onDelete: () => void; shopId?: string }) {
  return <div className="page-editor">
    <h3>このページを編集</h3>
    <label>ページのタイトル<input value={page.title} onChange={e => onChange({ ...page, title: e.target.value })} /></label>
    <label>メニューに表示する名前<input value={page.navigationLabel} onChange={e => onChange({ ...page, navigationLabel: e.target.value })} /></label>
    <label>ページのアドレス<input value={page.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={e => onChange({ ...page, slug: e.target.value })} /></label>
    <p className="small muted">半角の英小文字・数字・ハイフンを使えます。公開後に変えるとページのURLも変わります。</p>
    <label>ページ本文<textarea rows={10} value={page.body} onChange={e => onChange({ ...page, body: e.target.value })} /></label>
    <p className="small muted">「## 見出し」、箇条書き、リンクなどの Markdown を使えます。</p>
    {shopId && <ImagePicker shopId={shopId} value={page.imageId} change={imageId => onChange({ ...page, imageId, imageUrl: imageId ? "" : page.imageUrl })} />}
    <label>ページの画像（HTTPS URL）<input type="url" value={page.imageUrl} onChange={e => onChange({ ...page, imageUrl: e.target.value, imageId: undefined })} /></label>
    <label>ページの配置<select value={page.layout} onChange={e => onChange({ ...page, layout: e.target.value as ShopPage["layout"] })}><option value="standard">ゆったり</option><option value="compact">コンパクト</option></select></label>
    <button onClick={onDelete}>このページを削除する</button>
  </div>;
}
