import React, { useEffect, useRef, useState } from "react";
import {useApi} from "./api";
import {VoiceInput} from "./VoiceInput";
import type {ShopConfig} from "../server/domain";

// Capture the rendered page with its computed styles, without granting screen sharing.
// Cross-origin images without CORS are represented by their labelled image frame.
export async function capturePage(root: HTMLElement) {
  await document.fonts.ready;
  const original = [root, ...root.querySelectorAll<HTMLElement>("*")];
  const clone = root.cloneNode(true) as HTMLElement;
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  for (let i = 0; i < original.length; i++) {
    const style = getComputedStyle(original[i]);
    for (const key of Array.from(style)) copies[i].style.setProperty(key, style.getPropertyValue(key));
    if (copies[i] instanceof HTMLImageElement) {
      const img = original[i] as HTMLImageElement;
      const replacement = document.createElement("div");
      replacement.style.cssText = copies[i].style.cssText;
      replacement.textContent = img.alt || "紹介画像";
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
  const height = Math.min(root.scrollHeight, 2600);
  if (!width || !height) throw new Error("画面を表示してからお試しください");
  clone.style.width = `${width}px`;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("画面の取り込みに失敗しました。ページを再読み込みしてください。")); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1100 / width);
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fffdf8"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
export function VisualRequest({shopId, config, planId, root}: {shopId: string; config: ShopConfig; planId?: string; root: React.RefObject<HTMLDivElement | null>}) {
  const api = useApi();
  const [image, setImage] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [marked, setMarked] = useState(false);
  const [result, setResult] = useState<{id: string; explanation: string; candidates: {id: string; label: string}[]}>();
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<{id: string; summary: string[]; config: ShopConfig}>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  async function reset(source = image) {
    const img = new Image(); img.src = source; await img.decode();
    if (!canvas.current) return;
    canvas.current.width = img.width; canvas.current.height = img.height;
    canvas.current.getContext("2d")!.drawImage(img, 0, 0);
    setMarked(false); setResult(undefined); setTarget(""); setPlan(undefined);
  }
  useEffect(() => { if (image) void reset(); }, [image]);
  async function run(fn: () => Promise<void>) {setBusy(true); setError(""); try {await fn();} catch(e) {setError(e instanceof Error ? e.message : String(e));} finally {setBusy(false);}}
  return <div className="visual-request panel" data-capture-ignore>
    <button disabled={busy} onClick={() => run(async () => { if (root.current) setImage(await capturePage(root.current)); })}>✎ この画面にペンで変更を依頼</button>
    {error && <p className="alert" role="alert">{error}</p>}
    {image && <>
      <p>変更したい文言や画像、配置を赤いペンで囲んで、希望を教えてください。外部画像は枠で表示される場合があります。予約ルール・料金の変更は運営画面で言葉で依頼してください。</p>
      <canvas ref={canvas} aria-label="変更したい箇所を囲む画面" className="annotation-canvas"
        onPointerDown={e => {
          if (busy) return;
          e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true;
          const rect = e.currentTarget.getBoundingClientRect();
          const ctx = e.currentTarget.getContext("2d")!; ctx.beginPath(); ctx.strokeStyle = "#e32236"; ctx.lineWidth = 5; ctx.lineCap = "round";
          ctx.moveTo((e.clientX - rect.left) * e.currentTarget.width / rect.width, (e.clientY - rect.top) * e.currentTarget.height / rect.height);
          setMarked(true); setResult(undefined); setPlan(undefined);
        }}
        onPointerMove={e => {
          if (!drawing.current) return;
          const rect = e.currentTarget.getBoundingClientRect(); const ctx = e.currentTarget.getContext("2d")!;
          ctx.lineTo((e.clientX - rect.left) * e.currentTarget.width / rect.width, (e.clientY - rect.top) * e.currentTarget.height / rect.height); ctx.stroke();
        }} onPointerUp={() => {drawing.current = false;}} onPointerCancel={() => {drawing.current = false;}}
      />
      <button disabled={busy} onClick={() => reset()}>印を消して描き直す</button>
      <label>ここをどう変えたいですか<textarea maxLength={4000} value={instruction} onChange={e => {setInstruction(e.target.value); setResult(undefined); setPlan(undefined);}} placeholder="ここを『季節を楽しむネイル』に変えて"/></label>
      <VoiceInput shopId={shopId} onText={t => {setInstruction(v => v ? `${v}\n${t}` : t); setResult(undefined); setPlan(undefined);}} disabled={busy}/>
      <button disabled={busy || !marked || !instruction.trim()} onClick={() => run(async () => {
        const media = {mimeType: "image/png", data: canvas.current!.toDataURL("image/png").split(",")[1]};
        setResult(undefined); setTarget(""); setPlan(undefined);
        const r = await api<NonNullable<typeof result>>(`/api/shops/${shopId}/visual/identify`, {media, instruction, planId, displayed: config});
        setResult(r); if (r.candidates.length === 1) setTarget(r.candidates[0].id);
      })}>{busy ? "確認しています…" : "Gemini に印の対象を確認してもらう"}</button>
      {result && <div className="notice"><p>{result.explanation}</p><label>変更する対象を確認<select value={target} onChange={e => {setTarget(e.target.value); setPlan(undefined);}}><option value="">対象を選んでください</option>{result.candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button disabled={busy || !target} onClick={() => run(async () => {setPlan(await api(`/api/shops/${shopId}/plan`, {text: instruction, visual: {id: result.id, target}}));})}>この対象の差分プランを作る</button></div>}
      {plan && <div className="notice"><h3>差分プランを作成しました</h3><ul>{plan.summary.map(s => <li key={s}>{s}</li>)}</ul><p>まだ公開内容は変更されていません。</p><a className="button primary" href={`/?shop=${encodeURIComponent(shopId)}&plan=${encodeURIComponent(plan.id)}`}>運営画面でプランを確認・承認する →</a></div>}
      <button disabled={busy} onClick={() => {setImage(""); setResult(undefined); setPlan(undefined);}}>ペン入力を閉じる</button>
    </>}
  </div>;
}
