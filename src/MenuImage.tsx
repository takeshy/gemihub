import { tr } from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { useApi } from "./api";
import { createRequestId } from "./request-id";
import { menuImageLimit } from "../server/menu-image-domain";
import { RequestImagePicker } from "./RequestImagePicker";
import { ImageUploadStatus } from "./ImageUploadStatus";
import { loadMenuImage } from "./menu-image-loader";

export function MenuImage({ imageId, imageBase, suffix = "", name, className = "menu-image", style, view = "display" }: { imageId?: string; imageBase: string; suffix?: string; name: string; className?: string; style?: React.CSSProperties; view?: "display" | "thumbnail" }) {
  const api = useApi();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<{ id: string; url: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!globalThis.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "300px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [imageId]);
  useEffect(() => {
    let disposed = false;
    let url = "";
    setError("");
    setImage(undefined);
    if (!visible || !imageId) return;
    const path = `${imageBase}/${imageId}${suffix}`;
    loadMenuImage(api, `${path}${path.includes("?") ? "&" : "?"}view=${view}`).then(response => {
      if (disposed) return;
      url = URL.createObjectURL(new Blob([Uint8Array.from(atob(response.data), char => char.charCodeAt(0))], { type: response.mimeType }));
      setImage({ id: imageId, url });
    }).catch(error => { if (!disposed) setError(error.message); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [imageId, imageBase, suffix, visible, api, view]);
  if (!imageId) return null;
  return <span ref={ref} className={className} style={style}>{image?.id === imageId ? <img src={image.url} alt={tr("{0}の画像", name)} /> : <span>{error ? tr("画像を読み込めませんでした") : tr("画像を読み込み中…")}</span>}</span>;
}

export function MenuImageEditor({ shopId, imageId, name, change, uploading, label = tr("メニュー画像（任意）"), imageBase, pickerBase, uploadPath }: { label?: string; imageBase?: string; pickerBase?: string; uploadPath?: string; shopId: string; imageId?: string; name: string; change: (imageId: string | undefined) => void; uploading?: (busy: boolean) => void }) {
  const api = useApi();
  const [method, setMethod] = useState<"upload" | undefined>();
  const [pending, setPending] = useState<{ file: File; requestId: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentChange = useRef(change);
  currentChange.current = change;
  async function upload(action: { file: File; requestId: string }) {
    if (busy) return;
    setBusy(true); uploading?.(true); setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error(tr("画像を読み込めませんでした")));
        reader.readAsDataURL(action.file);
      });
      const result = await api<{ imageId: string }>(uploadPath || `/api/shops/${shopId}/menu-images`, { requestId: action.requestId, name: action.file.name, mimeType: action.file.type, data });
      currentChange.current(result.imageId); setPending(undefined);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); uploading?.(false); }
  }
  return <div className="menu-image-editor">
    <MenuImage imageId={imageId} imageBase={imageBase || `/api/shops/${shopId}/menu-images`} name={name} view="thumbnail" />
    <div><p>{label}</p><div className="menu-image-methods" role="group" aria-label={tr("{0}の画像の登録方法", name)}><button type="button" disabled={busy} aria-pressed={method === "upload"} onClick={() => setMethod("upload")}>{tr("画像をアップロード")}</button><RequestImagePicker shopId={shopId} max={1} selectionOnly preview={false} imageBase={pickerBase} value={imageId ? [imageId] : []} disabled={busy} label={tr("既存の画像から選ぶ")} onChange={ids => { change(ids[0]); setPending(undefined); setError(""); setMethod(undefined); }}/></div>
    {method === "upload" && <label>{label}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (file.size > menuImageLimit || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) { setPending(undefined); setError(tr("5MB以内のPNG・JPEG・GIF・WebP画像を選択してください")); return; }
      const action = { file, requestId: createRequestId() }; setPending(action); void upload(action);
    }} /></label>}
    <p className="small muted">{tr("1枚・5MBまで。アップロードした画像も画像管理に保存されます。画像を選んだ後、「保存」でお客様の画面に反映します。")}</p>
    {busy && <ImageUploadStatus name={pending?.file.name} />}
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="actions">{pending && !busy && error && <button type="button" onClick={() => void upload(pending)}>{tr("画像の保存を再試行")}</button>}{imageId && <button type="button" disabled={busy} onClick={() => { change(undefined); setPending(undefined); setError(""); }}>{tr("画像を解除")}</button>}</div>
    </div>
  </div>;
}
