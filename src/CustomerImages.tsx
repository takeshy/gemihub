import React, { useEffect, useRef, useState } from "react";
import type { CustomerAttachment, CustomerDetail, CustomerImage, CustomerImages } from "../server/customers";
import { useApi } from "./api";

type ImageItem = { file: CustomerAttachment; path: string; createdAt?: string };
const when = (value: string) => new Date(value).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

function useImage(path: string, mimeType: string, active = true) {
  const api = useApi();
  const [state, setState] = useState({ path: "", url: "", error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let objectUrl = "";
    setState({ path, url: "", error: "" });
    if (!active) return;
    api<{ data: string }>(path).then(response => {
      if (disposed) return;
      const data = Uint8Array.from(atob(response.data), char => char.charCodeAt(0));
      objectUrl = URL.createObjectURL(new Blob([data], { type: mimeType }));
      setState({ path, url: objectUrl, error: "" });
    }).catch(error => { if (!disposed) setState({ path, url: "", error: error.message }); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, mimeType, active, attempt, api]);
  return { url: active && state.path === path ? state.url : "", error: state.path === path ? state.error : "", retry: () => setAttempt(value => value + 1) };
}

export function CustomerImageDialog({ items, initialIndex, close }: { items: ImageItem[]; initialIndex: number; close: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const item = items[index];
  const { url, error, retry } = useImage(item.path, item.file.mimeType);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="customer-image-dialog" aria-label="画像の拡大表示" onClose={close} onClick={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={event => {
    if (event.key === "ArrowLeft") { event.preventDefault(); setIndex(value => Math.max(0, value - 1)); }
    if (event.key === "ArrowRight") { event.preventDefault(); setIndex(value => Math.min(items.length - 1, value + 1)); }
  }}>
    <div className="customer-image-dialog-header"><div><h2>{item.file.name}</h2>{item.createdAt && <p>{when(item.createdAt)}</p>}</div><button type="button" autoFocus onClick={close}>閉じる</button></div>
    <div className="customer-image-stage">
      {url ? <img src={url} alt={item.file.name} /> : error ? <div role="alert">{error}<button type="button" onClick={retry}>再読み込み</button></div> : <p role="status">画像を読み込んでいます…</p>}
    </div>
    <div className="customer-image-navigation"><button type="button" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>← 前の画像</button><span>{index + 1} / {items.length}</span><button type="button" disabled={index === items.length - 1} onClick={() => setIndex(value => value + 1)}>次の画像 →</button></div>
  </dialog>;
}

function Thumbnail({ item, open }: { item: ImageItem; open: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const { url, error, retry } = useImage(item.path, item.file.mimeType, visible);
  useEffect(() => {
    if (!globalThis.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: "300px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <>
    <button type="button" className="customer-image-thumb" ref={ref} onClick={open} aria-label={`${item.file.name} を拡大表示`}>
      {url ? <img src={url} alt={item.file.name} /> : <span>{error ? "画像を読み込めませんでした" : "画像を読み込んでいます…"}</span>}
    </button>
    {error && <div role="alert">{error}<button type="button" onClick={retry}>再読み込み</button></div>}
  </>;
}
export { Thumbnail as CustomerImageThumbnail };

export function CustomerImageGallery({ base, rangeQuery, back, saved }: { base: string; rangeQuery: string; back: () => void; saved: (customer: CustomerDetail) => void }) {
  const api = useApi();
  const [gallery, setGallery] = useState<CustomerImages>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState<number>();
  const [editing, setEditing] = useState<{ image: CustomerImage; name: string }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<CustomerImages>(`${base}/images`).then(result => { if (active) { setGallery(result); setError(""); } }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [base, attempt, api]);
  const items = gallery?.images.map(image => ({ file: image, createdAt: image.createdAt, path: `${base}/notes/${image.noteId}/files/${image.id}` })) || [];
  async function rename(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<CustomerDetail>(`${base}/notes/${editing.image.noteId}${rangeQuery}`, { attachmentNames: [{ id: editing.image.id, name: editing.name }], previousUpdatedAt: editing.image.noteUpdatedAt });
      saved(result);
      setEditing(undefined);
      setAttempt(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="customer-image-gallery">
    <button type="button" disabled={busy} onClick={back}>← お客様詳細へ</button>
    <div className="panel">
      <div className="section-top"><h2>{gallery?.name ? `${gallery.name} 様の画像一覧` : "画像一覧"}</h2><button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>再読み込み</button></div>
      <p className="small muted">すべての期間の画像を新しい順に表示します。写真をクリックすると拡大できます。</p>
      {error && <div className="alert" role="alert">{error}</div>}
      {!gallery && !error && <p role="status">画像一覧を読み込んでいます…</p>}
      {gallery?.images.length === 0 && <p className="empty">まだ画像はありません。お客様詳細のメモから画像を添付できます。</p>}
      <div className="customer-image-grid">{gallery?.images.map((image, index) => <figure key={image.id}>
        <Thumbnail item={items[index]} open={() => setZoom(index)} />
        <figcaption><strong>{image.name}</strong><time dateTime={image.createdAt}>{when(image.createdAt)}</time></figcaption>
        {editing?.image.id === image.id ? <form onSubmit={rename}>
          <label>ファイル名<input required maxLength={255} value={editing.name} disabled={busy} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
          <div className="actions"><button type="submit" disabled={busy || !editing.name.trim()}>名前を保存</button><button type="button" disabled={busy} onClick={() => setEditing(undefined)}>変更をやめる</button></div>
        </form> : <button type="button" disabled={busy} onClick={() => setEditing({ image, name: image.name })} aria-label={`${image.name} のファイル名を変更`}>ファイル名を変更</button>}
      </figure>)}</div>
    </div>
    {zoom !== undefined && items[zoom] && <CustomerImageDialog items={items} initialIndex={zoom} close={() => setZoom(undefined)} />}
  </section>;
}
