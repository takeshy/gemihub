import { tr } from "../shared/i18n";
import { createPortal } from "react-dom";
import React, { useEffect, useRef, useState } from "react";
import {useApi} from "./api";
import {DictationButton} from "./DictationButton";
import { RequestImagePicker } from "./RequestImagePicker";
import type {ShopConfig} from "../server/domain";

// Capture the rendered page with its computed styles, without granting screen sharing.
// Cross-origin images without CORS are represented by their labelled image frame.
export async function capturePage(root: HTMLElement) {
  await document.fonts.ready;
  const original = [root, ...root.querySelectorAll<HTMLElement>("*")];
  const clone = root.cloneNode(true) as HTMLElement;
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  for (let i = 0; i < original.length; i++) {
    if (original[i] instanceof HTMLInputElement && copies[i] instanceof HTMLInputElement) {
      const input = original[i] as HTMLInputElement;
      copies[i].setAttribute("value", input.value);
      if (input.checked) copies[i].setAttribute("checked", ""); else copies[i].removeAttribute("checked");
    }
    if (original[i] instanceof HTMLTextAreaElement) copies[i].textContent = (original[i] as HTMLTextAreaElement).value;
    if (original[i] instanceof HTMLSelectElement) {
      const selected = (original[i] as HTMLSelectElement).selectedIndex;
      copies[i].querySelectorAll("option").forEach((option, index) => {
        if (index === selected) option.setAttribute("selected", ""); else option.removeAttribute("selected");
      });
    }
    const style = getComputedStyle(original[i]);
    for (const key of Array.from(style)) copies[i].style.setProperty(key, style.getPropertyValue(key));
    if (copies[i] instanceof HTMLImageElement) {
      const img = original[i] as HTMLImageElement;
      const replacement = document.createElement("div");
      replacement.style.cssText = copies[i].style.cssText;
      replacement.textContent = img.alt || tr("紹介画像");
      // Existing image pixels can be inlined only when their origin permits it.
      try {
        const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        copies[i].setAttribute("src", canvas.toDataURL("image/png"));
        copies[i].removeAttribute("srcset");
      } catch { copies[i].replaceWith(replacement); }
    }
  }
  clone.querySelectorAll("script, iframe, [data-capture-ignore]").forEach(e => e.remove());
  clone.style.margin = "0";
  const width = Math.ceil(root.getBoundingClientRect().width);
  const height = root.scrollHeight;
  if (!width || !height) throw new Error(tr("画面を表示してからお試しください"));
  clone.style.width = `${width}px`;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(tr("画面の取り込みに失敗しました。ページを再読み込みしてください。"))); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1100 / width, 6000 / height);
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fffdf8"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
export function VisualRequest({shopId, config, root, local, screen, onLocalChange, onBusyChange, onActiveChange, triggerHost}: {
  shopId: string; config: ShopConfig; root: React.RefObject<HTMLDivElement | null>;
  local: { base: number; source: ShopConfig | null; pageId?: string; part?: "header" | "footer" };
  /** The screen being edited (tree ID, display name and exported file), sent with the request. */
  screen?: { id: string; label: string; file: string };
  onLocalChange: (config: ShopConfig) => void;
  onBusyChange?: (busy: boolean) => void;
  /** True while the captured screen is shown, so the live preview below can be hidden. */
  onActiveChange?: (active: boolean) => void;
  triggerHost?: HTMLElement | null;
}) {
  const api = useApi();
  const [image, setImage] = useState("");
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening,setListening]=useState(false);
  const [error, setError] = useState("");
  const [marked, setMarked] = useState(false);
  const [result, setResult] = useState<{id: string; explanation: string; candidates: {id: string; label: string}[]}>();
  const [target, setTarget] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  async function reset(source = image) {
    const img = new Image(); img.src = source; await img.decode();
    if (!canvas.current) return;
    canvas.current.width = img.width; canvas.current.height = img.height;
    canvas.current.getContext("2d")!.drawImage(img, 0, 0);
    setMarked(false); setResult(undefined); setTarget("");
  }
  const stopDictation = useRef<(() => void) | null>(null);
  useEffect(() => { if (image) void reset(); }, [image]);
  useEffect(() => { onActiveChange?.(!!image); }, [image]);
  useEffect(() => () => onActiveChange?.(false), []);
  const close = () => { stopDictation.current?.(); setImage(""); setResult(undefined); setError(""); };
  const identify = () => run(async () => {
    const media = {mimeType: "image/png", data: canvas.current!.toDataURL("image/png").split(",")[1]};
    setResult(undefined); setTarget("");
    const r = await api<NonNullable<typeof result>>(`/api/shops/${shopId}/visual/identify`, {media, instruction, displayed: config, local, ...(screen ? { screen } : {})});
    setResult(r); if (r.candidates.length === 1) setTarget(r.candidates[0].id);
  });
  async function run(fn: () => Promise<void>) {setBusy(true); onBusyChange?.(true); setError(""); try {await fn();} catch(e) {setError(e instanceof Error ? e.message : String(e));} finally {setBusy(false); onBusyChange?.(false);}}
  // The same button opens the pen and, pressed again, returns to the live preview.
  const trigger = <button className={`${triggerHost ? "editor-pen-button" : ""}${image ? " selected" : ""}`} aria-pressed={!!image} title={image ? tr("ペンをやめてプレビューに戻る") : tr("この画面を修正する")} disabled={busy} onClick={() => image ? close() : run(async () => { if (root.current) setImage(await capturePage(root.current)); })}>{image ? tr("修正をやめる") : tr("修正する")}</button>;
  return <>
    {triggerHost && createPortal(trigger, triggerHost)}
    {(!triggerHost || image || error) && <div className="visual-request panel" data-capture-ignore>
    {!triggerHost && trigger}
    {error && <p className="alert" role="alert">{error}</p>}
    {image && <>
      <p>{tr("変更したい文言や画像、配置を赤いペンで囲んで、希望を教えてください。外部画像は枠で表示される場合があります。ペンでは店名・紹介文・アクセス・ページ本文・画像・配置を変更できます。料金・スタッフ・営業時間・予約ルールはそれぞれの管理メニューで保存してください。")}</p>
      <canvas ref={canvas} aria-label={tr("変更したい箇所を囲む画面")} className="annotation-canvas"
        onPointerDown={e => {
          if (busy) return;
          e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true;
          const rect = e.currentTarget.getBoundingClientRect();
          const ctx = e.currentTarget.getContext("2d")!; ctx.beginPath(); ctx.strokeStyle = "#e32236"; ctx.lineWidth = 5; ctx.lineCap = "round";
          ctx.moveTo((e.clientX - rect.left) * e.currentTarget.width / rect.width, (e.clientY - rect.top) * e.currentTarget.height / rect.height);
          setMarked(true); setResult(undefined);
        }}
        onPointerMove={e => {
          if (!drawing.current) return;
          const rect = e.currentTarget.getBoundingClientRect(); const ctx = e.currentTarget.getContext("2d")!;
          ctx.lineTo((e.clientX - rect.left) * e.currentTarget.width / rect.width, (e.clientY - rect.top) * e.currentTarget.height / rect.height); ctx.stroke();
        }} onPointerUp={() => {drawing.current = false;}} onPointerCancel={() => {drawing.current = false;}}
      />
      <button type="button" className="text-button" disabled={busy || !marked} onClick={() => reset()}>{tr("印を消して描き直す")}</button>
      <form className="chat-composer" aria-label={tr("ペンで囲んだ箇所への依頼")} onSubmit={event => { event.preventDefault(); stopDictation.current?.(); if (instruction.trim()) void identify(); }}>
        <textarea aria-label={tr("ここをどう変えたいですか")} rows={3} maxLength={4000} disabled={busy} value={instruction} onChange={e => {setInstruction(e.target.value); setResult(undefined);}} placeholder={tr("ここを『季節を楽しむネイル』に変えて")}/>
        <div className="chat-composer-toolbar">
          <RequestImagePicker shopId={shopId} value={imageIds} disabled={busy || listening} label={tr("画像を添付")} onChange={ids => { setImageIds(ids); setResult(undefined); }} />
          <DictationButton onListening={setListening} value={instruction} onChange={text=>{setInstruction(text);setResult(undefined);}} stopRef={stopDictation} disabled={busy}/>
          <button type="submit" className="primary chat-send" disabled={busy || listening || !instruction.trim()}>{busy ? tr("確認しています…") : tr("送信")}</button>
        </div>
      </form>
      {result && <div className="notice"><p>{result.explanation}</p><label>{tr("変更する対象を確認")}<select value={target} onChange={e => setTarget(e.target.value)}><option value="">{tr("対象を選んでください")}</option>{result.candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button disabled={busy || !target} onClick={() => run(async () => {
          const proposed = await api<{config: ShopConfig}>(`/api/shops/${shopId}/visual/propose`, {id: result.id, target, instruction, imageIds});
          onLocalChange(proposed.config);
        })}>{tr("この対象をローカルに変更")}</button></div>}
    </>}
  </div>}
  </>;
}
