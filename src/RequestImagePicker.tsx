import { tr } from "../shared/i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "./api";
import { MenuImage } from "./MenuImage";
import { ImageLibrary } from "./ImageLibrary";
import { requestImageCountLimit, requestImageTotalLimit, type LibraryImage } from "../server/image-library-domain";

export function RequestImagePicker({ shopId, value, onChange, disabled = false, max = requestImageCountLimit, label = tr("依頼に使う画像を選ぶ"), selectionOnly = false, preview = true, imageBase, allowGeneration = true }: { shopId: string; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; max?: number; label?: string; selectionOnly?: boolean; preview?: boolean; imageBase?: string; allowGeneration?: boolean }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<LibraryImage[]>();
  const [selection, setSelection] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const base = imageBase || `/api/shops/${shopId}/images`;
  const managed = !imageBase;
  const valueKey = value.join(",");
  useEffect(() => {
    if ((!open && !valueKey) || (open && managed)) return;
    let active = true; setError("");
    api<LibraryImage[]>(base).then(result => { if (active) setImages(result); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [open, valueKey, base, api, attempt, managed]);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  useEffect(() => { if (disabled && open) setOpen(false); }, [disabled]);
  const receiveImages = useCallback((items: LibraryImage[] | undefined) => {
    setImages(items);
    if (items) setSelection(current => current.filter(id => items.some(image => image.id === id)));
  }, []);
  const receiveBusy = useCallback((busy: boolean) => { workingRef.current = busy; setWorking(busy); }, []);
  function choose(image: LibraryImage, toggle = true) {
    if (selection.includes(image.id)) { if (toggle) setSelection(selection.filter(id => id !== image.id)); return true; }
    const next = max === 1 ? [image.id] : [...selection, image.id];
    if (next.length > max) { setError(tr("{0}枚まで選択できます。", max)); return false; }
    const size = (max === 1 ? 0 : (images || []).filter(item => selection.includes(item.id)).reduce((sum, item) => sum + item.size, 0)) + image.size;
    if (size > requestImageTotalLimit) { setError(tr("画像は合計75MB以内にしてください。")); return false; }
    setSelection(next); setError(""); return true;
  }
  const visible = images?.filter(image => (source === "all" || image.source === source) && `${image.name} ${image.prompt || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="request-image-picker">
    <button type="button" disabled={disabled} onClick={() => { setSelection([...value]); setQuery(""); setSource("all"); setError(""); setImages(undefined); setOpen(true); }}>{label}</button>
    {preview && value.length > 0 && <div className="request-image-selection" aria-label={tr("依頼に選んだ画像")}>{value.map((id, index) => <div key={id}>
      <MenuImage imageId={id} imageBase={base} name={images?.find(image => image.id === id)?.name || tr("画像{0}", index + 1)} view="thumbnail" />
      <span>{images?.find(image => image.id === id)?.name || tr("画像{0}", index + 1)}</span><button type="button" disabled={disabled} aria-label={tr("画像{0}を依頼から外す", index + 1)} onClick={() => onChange(value.filter(current => current !== id))}>{tr("外す")}</button>
    </div>)}</div>}
    {error && !open && <p role="alert">{error}</p>}
    {open && createPortal(<dialog ref={dialog} className="request-image-dialog" aria-label={selectionOnly ? tr("画像を選ぶ") : tr("依頼の画像を選ぶ")} onCancel={event => { event.stopPropagation(); if (event.target !== event.currentTarget) return; if (workingRef.current) event.preventDefault(); else setOpen(false); }} onClose={event => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="section-top"><h2>{selectionOnly ? tr("画像を選ぶ") : tr("依頼の画像を選ぶ")}</h2><button type="button" disabled={working} onClick={() => setOpen(false)}>{tr("閉じる")}</button></div>
      <p>{tr("{0}枚まで選べます。", max)}{!selectionOnly && max > 1 && tr("合計75MBまで。大きな画像はAIへ渡す際に軽量化し、元画像はそのまま保存します。")}{tr("お客様メモの画像は含みません。")}</p>
      {error && <p className="alert" role="alert">{error}{!managed && !images && <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr("再試行")}</button>}</p>}
      {managed ? <ImageLibrary shopId={shopId} mode="select" selectedIds={selection} onSelect={image => choose(image)} onCreated={image => choose(image, false)} onImagesChange={receiveImages} onBusyChange={receiveBusy} allowGeneration={allowGeneration} /> : <>
        <div className="customer-controls"><label>{tr("画像を検索")}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><label>{tr("画像の種類")}<select value={source} onChange={event => setSource(event.target.value)}><option value="all">{tr("すべて")}</option><option value="upload">{tr("アップロード")}</option><option value="ai">{tr("AI生成")}</option></select></label></div>
        {!images && !error && <p role="status">{tr("画像を読み込んでいます…")}</p>}
        {images && !visible?.length && <p className="empty">{tr("条件に合う画像はありません。")}</p>}
        <div className="image-library-grid">{visible?.map(image => <button type="button" key={image.id} className={`request-image-option ${selection.includes(image.id) ? "image-selected" : ""}`} aria-pressed={selection.includes(image.id)} aria-label={tr("{0}を選択", image.name)} onClick={() => choose(image)}><MenuImage imageId={image.id} imageBase={base} name={image.name} className="library-image" view="thumbnail" /><strong>{image.name}</strong><span>{selection.includes(image.id) ? tr("✓ 選択中") : tr("選択する")}</span></button>)}</div>
      </>}
      <div className="actions request-image-dialog-actions"><span>{selection.length}/{max}{tr("枚")}</span><button type="button" className="primary" disabled={working || !images || (selectionOnly && selection.length !== 1)} onClick={() => { onChange(selection); setOpen(false); }}>{selectionOnly ? tr("この画像を使う") : tr("選択した画像を使う")}</button><button type="button" disabled={working} onClick={() => setOpen(false)}>{tr("やめる")}</button></div>
    </dialog>, document.body)}
  </div>;
}
