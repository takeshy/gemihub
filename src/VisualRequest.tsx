import { tr } from "../shared/i18n";
import { createPortal } from "react-dom";
import React, { useEffect, useRef, useState } from "react";
import {useApi} from "./api";
import {DictationButton} from "./DictationButton";
import { RequestImagePicker } from "./RequestImagePicker";
import type {ShopConfig} from "../server/domain";
import type { Plan } from "./App";
import { submitOnShortcut } from "./submit-shortcut";
import { MenuImage } from "./MenuImage";

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
export function VisualRequest({shopId, config, root, local, screen, onLocalChange, onBusyChange, onActiveChange, triggerHost, initialPlan, onPlan, disabled = false}: {
  shopId: string; config: ShopConfig; root: React.RefObject<HTMLDivElement | null>;
  local: { base: number; source: ShopConfig | null; pageId?: string; part?: "header" | "footer" };
  screen?: { id: string; label: string; file: string };
  onLocalChange: (config: ShopConfig) => void;
  onBusyChange?: (busy: boolean) => void;
  /** The capture replaces the live preview while it is being annotated. */
  onActiveChange?: (active: boolean) => void;
  triggerHost?: HTMLElement | null;
  initialPlan?: Plan;
  onPlan?: (plan: Plan) => void;
  disabled?: boolean;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState("");
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = busy || disabled;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [marked, setMarked] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string; imageIds?: string[] }[]>([]);
  const [result, setResult] = useState<{ id: string; explanation: string; candidates: { id: string; label: string }[] }>();
  const [target, setTarget] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const alive = useRef(true);
  const pendingContext = useRef("");
  const submitted = useRef("");
  const failed = useRef<string | undefined>(undefined);
  const stopDictation = useRef<(() => void) | null>(null);
  type Revision = { config: ShopConfig; plan?: Plan };
  const scopeKey = JSON.stringify({ shopId, base: local.base, source: local.source, screen: screen?.id });
  const revisionKey = (revision: Revision) => JSON.stringify([revision.config, revision.plan?.id]);
  const currentKey = revisionKey({ config, plan: initialPlan });
  const [history, setHistory] = useState(() => ({ scope: scopeKey, entries: [structuredClone({ config, plan: initialPlan })] as Revision[], index: 0 }));
  function remember(revision: Revision) {
    setHistory(current => {
      if (current.scope !== scopeKey) return { scope: scopeKey, entries: [structuredClone(revision)], index: 0 };
      if (revisionKey(current.entries[current.index]) === revisionKey(revision)) return current;
      const entries = [...current.entries.slice(0, current.index + 1), structuredClone(revision)];
      return { scope: scopeKey, entries, index: entries.length - 1 };
    });
  }
  // Manual edits join the same history; a new published baseline starts a fresh one.
  useEffect(() => { remember({ config, plan: initialPlan }); }, [scopeKey, currentKey]);
  const append = (message: { role: "user" | "assistant"; text: string; imageIds?: string[] }) => setMessages(items => [...items, message].slice(-24));
  const clearCapture = () => { setImage(""); setResult(undefined); setTarget(""); setMarked(false); };
  const close = () => { stopDictation.current?.(); setOpen(false); clearCapture(); setError(""); };
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  function moveHistory(offset: number) {
    if (locked || history.scope !== scopeKey) return;
    const index = history.index + offset;
    if (index < 0 || index >= history.entries.length) return;
    const revision = structuredClone(history.entries[index]);
    stopDictation.current?.(); clearCapture(); setError(""); pendingContext.current = ""; submitted.current = ""; failed.current = undefined;
    setHistory(current => ({ ...current, index }));
    if (revision.plan) onPlan?.(revision.plan); else onLocalChange(revision.config);
  }
  async function reset() {
    const img = new Image(); img.src = image; await img.decode();
    if (!canvas.current) return;
    canvas.current.width = img.width; canvas.current.height = img.height;
    canvas.current.getContext("2d")!.drawImage(img, 0, 0);
    setMarked(false); setResult(undefined); setTarget("");
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; onActiveChange?.(false); onBusyChange?.(false); }; }, []);
  useEffect(() => { if (image) { void reset(); canvas.current?.scrollIntoView({ block: "nearest" }); } }, [image]);
  useEffect(() => { onActiveChange?.(!!image); }, [image]);
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("visual-chat-open");
    composer.current?.focus({ preventScroll: true });
    return () => document.body.classList.remove("visual-chat-open");
  }, [open]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, result, error, busy]);
  async function run(fn: () => Promise<void>) {
    if (locked) return;
    setBusy(true); onBusyChange?.(true); setError("");
    try { await fn(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (alive.current) { setBusy(false); onBusyChange?.(false); } }
  }
  const capture = () => run(async () => {
    setOpen(true); await frame(); await frame();
    if (root.current && alive.current) { setImage(await capturePage(root.current)); setResult(undefined); pendingContext.current = ""; }
  });
  async function submitRequest(input = instruction) {
    const text = input.trim(); if (locked || !text) return;
    stopDictation.current?.();
    if (failed.current !== text) append({ role: "user", text, imageIds: [...imageIds] });
    setInstruction(""); setResult(undefined); setTarget("");
    await run(async () => {
      try {
        const source = image ? canvas.current!.toDataURL("image/png") : root.current ? await capturePage(root.current) : "";
        if (!source) throw new Error(tr("画面を表示してからお試しください"));
        const media = { mimeType: "image/png", data: source.split(",")[1] };
        if (initialPlan) {
          const response = await api<{ plan: Plan }>(`/api/shops/${shopId}/plans/${initialPlan.id}/theme`, { instruction: text, imageIds, media });
          if (!alive.current) return;
          remember({ config: response.plan.config, plan: response.plan });
          onPlan?.(response.plan); clearCapture(); setImageIds([]); pendingContext.current = "";
          append({ role: "assistant", text: tr("画面イメージを更新しました。確認してください。") });
        } else {
          const combined = [pendingContext.current, text].filter(Boolean).join("\n\n").slice(-4000);
          const response = await api<NonNullable<typeof result>>(`/api/shops/${shopId}/visual/identify`, { media, instruction: combined, displayed: config, local, ...(screen ? { screen } : {}) });
          if (!alive.current) return;
          pendingContext.current = combined; submitted.current = combined;
          setResult(response); if (response.candidates.length === 1) setTarget(response.candidates[0].id);
          append({ role: "assistant", text: response.explanation });
        }
        failed.current = undefined;
      } catch (e) { failed.current = text; if (alive.current) setInstruction(current => current || text); throw e; }
    });
  }
  const trigger = <button className={`${triggerHost ? "editor-pen-button" : ""}${image ? " selected" : ""}`} aria-pressed={!!image} title={image ? tr("ペンをやめてプレビューに戻る") : tr("この画面を修正する")} disabled={locked} onClick={() => image ? close() : void capture()}>{image ? tr("修正をやめる") : tr("修正する")}</button>;
  const historyControls = <div className="visual-edit-history" role="group" aria-label={tr("修正履歴")}>
    <button type="button" disabled={locked || history.scope !== scopeKey || history.index === 0} aria-label={tr("前の状態に戻る")} onClick={() => moveHistory(-1)}><span aria-hidden="true">←</span>{tr("戻る")}</button>
    <span className="small muted" aria-live="polite">{history.index + 1} / {history.entries.length}</span>
    <button type="button" disabled={locked || history.scope !== scopeKey || history.index >= history.entries.length - 1} aria-label={tr("次の状態に進む")} onClick={() => moveHistory(1)}>{tr("進む")}<span aria-hidden="true">→</span></button>
  </div>;
  return <>
    {triggerHost && createPortal(<>{trigger}{!open && history.entries.length > 1 && historyControls}</>, triggerHost)}
    {(!triggerHost || image) && <div className="visual-request panel" data-capture-ignore>
      {!triggerHost && <>{trigger}{!open && history.entries.length > 1 && historyControls}</>}
      {image && <>
        <canvas ref={canvas} aria-label={tr("変更したい箇所を囲む画面")} className="annotation-canvas"
          onPointerDown={event => {
            if (locked) return;
            event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true;
            const rect = event.currentTarget.getBoundingClientRect(), ctx = event.currentTarget.getContext("2d")!;
            ctx.beginPath(); ctx.strokeStyle = "#e32236"; ctx.lineWidth = 5; ctx.lineCap = "round";
            ctx.moveTo((event.clientX - rect.left) * event.currentTarget.width / rect.width, (event.clientY - rect.top) * event.currentTarget.height / rect.height);
            setMarked(true); setResult(undefined);
          }}
          onPointerMove={event => {
            if (!drawing.current || locked) return;
            const rect = event.currentTarget.getBoundingClientRect(), ctx = event.currentTarget.getContext("2d")!;
            ctx.lineTo((event.clientX - rect.left) * event.currentTarget.width / rect.width, (event.clientY - rect.top) * event.currentTarget.height / rect.height); ctx.stroke();
          }} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }}
        />
        <button type="button" className="text-button" disabled={locked || !marked} onClick={() => void reset()}>{tr("印を消して描き直す")}</button>
      </>}
    </div>}
    {open && createPortal(<aside className="visual-chat-panel" aria-label={tr("画面の修正チャット")} data-capture-ignore>
      <div className="visual-chat-heading"><div><h3>{tr("画面の修正")}</h3><p className="small muted">{screen?.label}</p></div><button type="button" disabled={locked} aria-label={tr("閉じる")} onClick={close}>×</button></div>
      <p className="small">{tr("赤ペンで囲むか、変えたいことをそのまま書いてください。")}</p>
      <div className="visual-chat-view">{historyControls}<button type="button" className="text-button" disabled={locked} onClick={() => image ? clearCapture() : void capture()}>{image ? tr("画面を操作する") : tr("赤ペンで囲む")}</button></div>
      <div ref={log} className="chat-log visual-chat-log" role="log" aria-label={tr("画面の修正の会話")} aria-live="polite">
        {messages.map((message, index) => <article key={index} className={`chat-message chat-message-${message.role}`}><b>{message.role === "user" ? tr("あなた") : "AI"}</b><div className="pre-wrap">{message.text}</div>{!!message.imageIds?.length && <div className="chat-message-images">{message.imageIds.map((id, i) => <MenuImage key={id} imageId={id} imageBase={`/api/shops/${shopId}/menu-images`} name={tr("添付画像{0}", i + 1)} className="chat-message-image" />)}</div>}</article>)}
        {result && <div className="notice visual-chat-confirmation"><label>{tr("変更する対象を確認")}<select disabled={locked} value={target} onChange={event => setTarget(event.target.value)}><option value="">{tr("対象を選んでください")}</option>{result.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label><button disabled={locked || !target} onClick={() => void run(async () => {
          const proposed = await api<{ config: ShopConfig }>(`/api/shops/${shopId}/visual/propose`, { id: result.id, target, instruction: submitted.current, imageIds });
          if (!alive.current) return;
          remember({ config: proposed.config });
          onLocalChange(proposed.config); clearCapture(); setImageIds([]); pendingContext.current = "";
          append({ role: "assistant", text: tr("画面を更新しました。まだ本番には反映していません。") });
        })}>{tr("この箇所を修正する")}</button></div>}
        {error && <p className="alert" role="alert">{error}</p>}
        {busy && <p role="status">{tr("修正を確認しています…")}</p>}
      </div>
      <form className="chat-composer" aria-label={tr("ペンで囲んだ箇所への依頼")} onSubmit={event => { event.preventDefault(); void submitRequest(); }}>
        <textarea ref={composer} aria-label={tr("ここをどう変えたいですか")} aria-keyshortcuts="Control+Enter Meta+Enter" onKeyDown={event => submitOnShortcut(event)} rows={3} maxLength={4000} disabled={locked} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={tr("ここを『季節を楽しむネイル』に変えて")} />
        <div className="chat-composer-toolbar">
          <RequestImagePicker shopId={shopId} value={imageIds} disabled={locked || listening} label={tr("画像を添付")} onChange={ids => { setImageIds(ids); setResult(undefined); }} />
          <DictationButton onListening={setListening} value={instruction} onChange={setInstruction} onSend={value => void submitRequest(value)} stopRef={stopDictation} disabled={locked} />
          <button type="submit" className="primary chat-send" disabled={locked || listening || !instruction.trim()}>{busy ? tr("確認しています…") : tr("送信")}</button>
        </div>
      </form>
    </aside>, document.body)}
  </>;
}
