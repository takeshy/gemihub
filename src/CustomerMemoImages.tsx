import React, { useEffect, useState } from "react";
import { useApi } from "./api";
import { CustomerImageDialog, CustomerImageThumbnail } from "./CustomerImages";
import type { CustomerMemoImage } from "../server/image-library-domain";

export function CustomerMemoImages({ shopId }: { shopId: string }) {
  const api = useApi();
  const [images, setImages] = useState<CustomerMemoImage[]>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState<number>();
  useEffect(() => {
    let active = true; setError("");
    api<CustomerMemoImage[]>(`/api/shops/${shopId}/images/customer-memos`).then(result => { if (active) setImages(result); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, shopId, attempt]);
  const visible = images?.filter(image => `${image.customerName} ${image.email} ${image.name}`.toLowerCase().includes(query.trim().toLowerCase())) || [];
  const items = visible.map(image => ({ file: image, createdAt: image.createdAt, path: `/api/shops/${shopId}/customers/${encodeURIComponent(image.email)}/notes/${encodeURIComponent(image.noteId)}/files/${encodeURIComponent(image.id)}` }));
  return <section className="customer-memo-images" aria-label="お客様メモの画像">
    <div className="section-top"><h3>お客様メモの画像</h3><button type="button" onClick={() => setAttempt(value => value + 1)}>一覧を更新</button></div>
    <p>お客様のメモに添付した画像を、全期間から新しい順に表示します。非公開の閲覧専用です。依頼の画像選択には表示しません。</p>
    <label className="field">お客様・画像名で検索<input type="search" value={query} onChange={event => { setQuery(event.target.value); setZoom(undefined); }} /></label>
    {error && <p className="alert" role="alert">{error}</p>}
    {!images && !error && <p role="status">お客様メモの画像を読み込んでいます…</p>}
    {images && !visible.length && <p className="empty">{images.length ? "条件に合う画像はありません。" : "お客様メモの画像はまだありません。"}</p>}
    <div className="customer-image-grid">{visible.map((image, index) => <figure key={`${image.noteId}:${image.id}`}>
      <CustomerImageThumbnail item={items[index]} open={() => setZoom(index)} />
      <figcaption><strong>{image.name}</strong><p>{image.customerName || "氏名未記入"} · {image.email}</p><time dateTime={image.createdAt}>{new Date(image.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}</time></figcaption>
    </figure>)}</div>
    {zoom !== undefined && items[zoom] && <CustomerImageDialog items={items} initialIndex={zoom} close={() => setZoom(undefined)} />}
  </section>;
}
