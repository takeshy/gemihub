import React, { useEffect, useRef, useState } from "react";
import { useApi } from "./api";
import { createRequestId } from "./request-id";
import { menuImageLimit, type MenuImageData } from "../server/menu-image-domain";
import { ImagePicker } from "./ImageLibrary";

export function MenuImage({ imageId, imageBase, suffix = "", name, className = "menu-image" }: { imageId?: string; imageBase: string; suffix?: string; name: string; className?: string }) {
  const api = useApi();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<{ id: string; url: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!globalThis.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: "300px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [imageId]);
  useEffect(() => {
    let disposed = false;
    let url = "";
    setError("");
    setImage(undefined);
    if (!visible || !imageId) return;
    api<MenuImageData>(`${imageBase}/${imageId}${suffix}`).then(response => {
      if (disposed) return;
      url = URL.createObjectURL(new Blob([Uint8Array.from(atob(response.data), char => char.charCodeAt(0))], { type: response.mimeType }));
      setImage({ id: imageId, url });
    }).catch(error => { if (!disposed) setError(error.message); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [imageId, imageBase, suffix, visible, api]);
  if (!imageId) return null;
  return <span ref={ref} className={className}>{image?.id === imageId ? <img src={image.url} alt={`${name}の画像`} /> : <span>{error ? "画像を読み込めませんでした" : "画像を読み込み中…"}</span>}</span>;
}

export function MenuImageEditor({ shopId, imageId, name, change, uploading }: { shopId: string; imageId?: string; name: string; change: (imageId: string | undefined) => void; uploading?: (busy: boolean) => void }) {
  const api = useApi();
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
        reader.onerror = () => reject(new Error("画像を読み込めませんでした"));
        reader.readAsDataURL(action.file);
      });
      const result = await api<{ imageId: string }>(`/api/shops/${shopId}/menu-images`, { requestId: action.requestId, name: action.file.name, mimeType: action.file.type, data });
      currentChange.current(result.imageId); setPending(undefined);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); uploading?.(false); }
  }
  return <div className="menu-image-editor">
    <MenuImage imageId={imageId} imageBase={`/api/shops/${shopId}/menu-images`} name={name} />
    <div><label>メニュー画像（任意）<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (file.size > menuImageLimit || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) { setPending(undefined); setError("5MB以内のPNG・JPEG・GIF・WebP画像を選択してください"); return; }
      const action = { file, requestId: createRequestId() }; setPending(action); void upload(action);
    }} /></label>
    <p className="small muted">1枚・5MBまで。画像を選んだ後、「保存」で予約画面に反映します。</p>
    <ImagePicker shopId={shopId} value={imageId} change={change} preview={false} />
    {busy && <p role="status">画像を保存しています…</p>}
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="actions">{pending && !busy && error && <button type="button" onClick={() => void upload(pending)}>画像の保存を再試行</button>}{imageId && <button type="button" disabled={busy} onClick={() => { change(undefined); setPending(undefined); setError(""); }}>画像を解除</button>}</div>
    </div>
  </div>;
}
