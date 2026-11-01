import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "./api";
import { MenuImage } from "./MenuImage";
import { requestImageCountLimit, requestImageTotalLimit, type LibraryImage } from "../server/image-library-domain";

export function RequestImagePicker({ shopId, value, onChange, disabled = false, max = requestImageCountLimit, label = "依頼に使う画像を選ぶ", selectionOnly = false, preview = true, imageBase }: { shopId: string; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; max?: number; label?: string; selectionOnly?: boolean; preview?: boolean; imageBase?: string }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<LibraryImage[]>();
  const [selection, setSelection] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const base = imageBase || `/api/shops/${shopId}/images`;
  const valueKey = value.join(",");
  useEffect(() => {
    if (!open && !valueKey) return;
    let active = true; setError(""); if (open) setImages(undefined);
    api<LibraryImage[]>(base).then(result => { if (active) setImages(result); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [open, valueKey, base, api, attempt]);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  useEffect(() => { if (disabled && open) setOpen(false); }, [disabled]);
  const total = (images || []).filter(image => selection.includes(image.id)).reduce((sum,image) => sum + image.size, 0);
  const visible = images?.filter(image => (source === "all" || image.source === source) && `${image.name} ${image.prompt || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="request-image-picker">
    <button type="button" disabled={disabled} onClick={() => { setSelection([...value]); setQuery(""); setOpen(true); }}>{label}</button>
    {preview && value.length > 0 && <div className="request-image-selection" aria-label="依頼に選んだ画像">{value.map((id, index) => <div key={id}>
      <MenuImage imageId={id} imageBase={base} name={images?.find(image => image.id === id)?.name || `画像${index + 1}`} />
      <span>{images?.find(image => image.id === id)?.name || `画像${index + 1}`}</span><button type="button" disabled={disabled} aria-label={`画像${index + 1}を依頼から外す`} onClick={() => onChange(value.filter(current => current !== id))}>外す</button>
    </div>)}</div>}
    {error && !open && <p role="alert">{error}</p>}
    {open && createPortal(<dialog ref={dialog} className="request-image-dialog" aria-label={selectionOnly ? "画像を選ぶ" : "依頼の画像を選ぶ"} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <div className="section-top"><h2>{selectionOnly ? "画像を選ぶ" : "依頼の画像を選ぶ"}</h2><button type="button" onClick={() => setOpen(false)}>閉じる</button></div>
      <p>画像管理のアップロード画像・AI生成画像から{max}枚まで選べます。{!selectionOnly && max > 1 && "合計75MBまで。大きな画像はAIへ渡す際に軽量化し、元画像はそのまま保存します。"}お客様メモの画像は含みません。</p>
      {error && <p className="alert" role="alert">{error}{!images && <button type="button" onClick={() => setAttempt(value => value + 1)}>再試行</button>}</p>}
      <div className="customer-controls"><label>画像を検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><label>画像の種類<select value={source} onChange={event => setSource(event.target.value)}><option value="all">すべて</option><option value="upload">アップロード</option><option value="ai">AI生成</option></select></label></div>
      {!images && !error && <p role="status">画像を読み込んでいます…</p>}
      {images && !visible?.length && <p className="empty">{images.length ? "条件に合う画像はありません。" : "画像管理で画像をアップロードするか、AIで生成してください。"}</p>}
      <div className="image-library-grid">{visible?.map(image => <button type="button" key={image.id} className={`request-image-option ${selection.includes(image.id) ? "image-selected" : ""}`} aria-pressed={selection.includes(image.id)} aria-label={`${image.name}を選択`} onClick={() => {
        if (selection.includes(image.id)) setSelection(selection.filter(id => id !== image.id));
        else if (max === 1) setSelection([image.id]);
        else if (selection.length < max && total + image.size <= requestImageTotalLimit) { setSelection([...selection, image.id]); setError(""); }
        else if (total + image.size > requestImageTotalLimit) setError("画像は合計75MB以内にしてください。");
        else setError(`${max}枚まで選択できます。`);
      }}><MenuImage imageId={image.id} imageBase={base} name={image.name} className="library-image" /><strong>{image.name}</strong><span className="pill">{image.source === "ai" ? "AI生成" : "アップロード"}</span>{image.usedBy.length > 0 && <small>使用中：{image.usedBy.join("、")}</small>}<span>{selection.includes(image.id) ? "✓ 選択中" : "選択する"}</span></button>)}</div>
      <div className="actions request-image-dialog-actions"><span>{selection.length}/{max}枚</span><button type="button" className="primary" disabled={selectionOnly && selection.length !== 1} onClick={() => { onChange(selection); setOpen(false); }}>{selectionOnly ? "この画像を使う" : "選択した画像を使う"}</button><button type="button" onClick={() => setOpen(false)}>やめる</button></div>
    </dialog>, document.body)}
  </div>;
}
