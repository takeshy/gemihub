import { tr } from "../shared/i18n";
import { useLeaveGuard } from "./leave-guard";
import { createPortal } from "react-dom";
import React, { useEffect, useRef, useState } from "react";
import {useApi} from "./api";
import {DictationButton} from "./DictationButton";
import { RequestImagePicker } from "./RequestImagePicker";
import type {ShopConfig} from "../server/domain";
import type { Plan } from "./App";
import { submitOnShortcut } from "./submit-shortcut";
import { MenuImage } from "./MenuImage";
import { VisualChangeReview } from "./VisualChangeReview";
import { useChatPanelCollapse } from "./ChatPanelCollapse";
import { VisualGenerationStatus, type VisualWork } from "./VisualGenerationProgress";
import { createRequestId } from "./request-id";
import { visualGenerationTimeoutMs } from "../shared/visual-progress";
import type { VisualMessage } from "../shared/visual-conversation";
import type { VisualPreviewOptions } from "../shared/visual-review";

// Capture the rendered page with its computed styles, without granting screen sharing.
// Cross-origin images without CORS are represented by their labelled image frame.
export async function capturePage(root: HTMLElement) {
  await document.fonts.ready;
  // The side chat narrows the preview into the phone layout; capture the width the page has without it.
  // A phone-width preview is already the layout being edited.
  const covered = document.body.classList.contains("visual-chat-open") && root.dataset.device !== "phone" ? parseFloat(getComputedStyle(document.body).paddingRight) || 0 : 0;
  if (!covered) return captureRendered(root);
  const restore = root.style.cssText;
  root.style.width = `${root.getBoundingClientRect().width + covered}px`; root.style.maxWidth = "none";
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  try { return await captureRendered(root); } finally { root.style.cssText = restore; }
}
async function captureRendered(root: HTMLElement) {
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
type Identified = { id: string; explanation: string; candidates: { id: string; label: string }[] };
type Revision = { config: ShopConfig; plan?: Plan };
export function VisualRequest({shopId, config, root, local, screen, onLocalChange, onBusyChange, onActiveChange, triggerHost, historyHost, initialPlan, onPlan, renderPreview, reviewPreview, disabled = false}: {
  shopId: string; config: ShopConfig; root: React.RefObject<HTMLDivElement | null>;
  local: { base: number; source: ShopConfig | null; pageId?: string; part?: "header" | "footer"; theme?: boolean };
  screen?: { id: string; label: string; file: string };
  onLocalChange: (config: ShopConfig) => void;
  onBusyChange?: (busy: boolean) => void;
  /** The capture replaces the live preview while it is being annotated. */
  onActiveChange?: (active: boolean) => void;
  triggerHost?: HTMLElement | null;
  historyHost?: HTMLElement | null;
  initialPlan?: Plan;
  onPlan?: (plan: Plan) => void;
  disabled?: boolean;
  renderPreview?: (config: ShopConfig) => React.ReactNode;
  reviewPreview?: VisualPreviewOptions;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const chatPanel = useChatPanelCollapse(open, tr("画面の修正"));
  const [image, setImage] = useState("");
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState<VisualWork>();
  const ownsBusy = useRef(false);
  const locked = busy || disabled;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [marked, setMarked] = useState(false);
  const [messages, setMessages] = useState<(VisualMessage & { imageIds?: string[] })[]>([]);
  const [result, setResult] = useState<Identified & { before: ShopConfig; key: string; scope: string }>();
  const [target, setTarget] = useState("");
  const [proposal, setProposal] = useState<{ config: ShopConfig; before: ShopConfig; summary: string[]; visualReview?: { approved: boolean; attempts: number }; context: string; key: string; scope: string }>();
  const submittedMedia = useRef<{ mimeType: "image/png"; data: string } | undefined>(undefined);
  const canvas = useRef<HTMLCanvasElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const alive = useRef(true);
  const pendingContext = useRef("");
  const failed = useRef<string | undefined>(undefined);
  const stopDictation = useRef<(() => void) | null>(null);
  useLeaveGuard(busy ? tr("AIが画面を修正しています。移動すると修正が中断され、内容が失われます。移動しますか？") : result || proposal ? tr("AIの修正案をまだ「OK」で取り込んでいません。移動すると修正案が失われます。移動しますか？") : undefined);
  const scopeKey = JSON.stringify({ shopId, base: local.base, source: local.source, screen: screen?.id });
  const revisionKey = (revision: Revision) => JSON.stringify([revision.config, revision.plan?.id]);
  const currentKey = revisionKey({ config, plan: initialPlan });
  // A proposal is tied to the exact local version reviewed; remote adoption and
  // manual edits must not let an old OK replace a newer local draft.
  const proposalIsCurrent = !proposal || proposal.key === currentKey && proposal.scope === scopeKey;
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
  const discardProposal = () => { setProposal(undefined); clearCapture(); setImageIds([]); pendingContext.current = ""; submittedMedia.current = undefined; setError(""); };
  const close = () => { stopDictation.current?.(); setOpen(false); discardProposal(); };
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  function moveHistory(offset: number) {
    if (locked || history.scope !== scopeKey) return;
    const index = history.index + offset;
    if (index < 0 || index >= history.entries.length) return;
    const revision = structuredClone(history.entries[index]);
    stopDictation.current?.(); clearCapture(); setError(""); pendingContext.current = ""; failed.current = undefined;
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
  useEffect(() => { alive.current = true; return () => { alive.current = false; onActiveChange?.(false); if (ownsBusy.current) onBusyChange?.(false); }; }, []);
  useEffect(() => { if (image) { void reset(); canvas.current?.scrollIntoView({ block: "nearest" }); } }, [image]);
  useEffect(() => { onActiveChange?.(!!image); }, [image]);
  useEffect(() => {
    if (!chatPanel.expanded) return;
    document.body.classList.add("visual-chat-open");
    composer.current?.focus({ preventScroll: true });
    return () => document.body.classList.remove("visual-chat-open");
  }, [chatPanel.expanded]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, result, error, busy]);
  async function run(fn: () => Promise<void>) {
    if (locked) return;
    ownsBusy.current = true; setBusy(true); setWork({ startedAt: Date.now(), stage: "preparing" }); onBusyChange?.(true); setError("");
    try { await fn(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (alive.current) { ownsBusy.current = false; setBusy(false); setWork(undefined); onBusyChange?.(false); } }
  }
  async function propose(body: Record<string, unknown> & { id: string }) {
    const requestId = createRequestId();
    setWork(current => ({ startedAt: current?.startedAt || Date.now(), stage: "preparing", visualId: body.id, requestId }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), visualGenerationTimeoutMs + 30000);
    try {
      return await api<{ config: ShopConfig; summary: string[]; visualReview: { approved: boolean; attempts: number } }>(`/api/shops/${shopId}/visual/propose`, { ...body, requestId }, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(tr("AIの応答に時間がかかっています。少し時間をおいてお試しください。"));
      throw error;
    } finally { clearTimeout(timer); }
  }
  const capture = () => run(async () => {
    setOpen(true); await frame(); await frame();
    if (root.current && alive.current) { setImage(await capturePage(root.current)); setResult(undefined); pendingContext.current = ""; }
  });
  async function submitRequest(input = instruction) {
    const text = input.trim(); if (locked || !text) return;
    stopDictation.current?.();
    // A failed send is already visible in the log, but remains the current instruction on retry.
    const previousMessages = (failed.current === text && messages.at(-1)?.role === "user" ? messages.slice(0, -1) : messages).map(({ role, text }) => ({ role, text }));
    if (failed.current !== text) append({ role: "user", text, imageIds: [...imageIds] });
    setInstruction(""); setResult(undefined); setTarget("");
    await run(async () => {
      try {
        const source = image ? canvas.current!.toDataURL("image/png") : root.current ? await capturePage(root.current) : "";
        if (!source) throw new Error(tr("画面を表示してからお試しください"));
        const media = { mimeType: "image/png" as const, data: source.split(",")[1] };
        submittedMedia.current = media;
        if (initialPlan) {
          setWork(current => ({ startedAt: current?.startedAt || Date.now(), stage: "generating" }));
          const response = await api<{ plan: Plan }>(`/api/shops/${shopId}/plans/${initialPlan.id}/theme`, { instruction: text, messages: previousMessages, preview: reviewPreview, imageIds, media });
          if (!alive.current) return;
          remember({ config: response.plan.config, plan: response.plan });
          onPlan?.(response.plan); clearCapture(); setImageIds([]); pendingContext.current = "";
          append({ role: "assistant", text: tr("画面イメージを更新しました。確認してください。") });
        } else {
          const combined = [pendingContext.current, text].filter(Boolean).join("\n\n").slice(-4000);
          setWork(current => ({ startedAt: current?.startedAt || Date.now(), stage: "identifying" }));
          const response = await api<Identified>(`/api/shops/${shopId}/visual/identify`, { media, instruction: combined, messages: previousMessages, preview: reviewPreview, displayed: config, local, ...(screen ? { screen } : {}) });
          if (!alive.current) return;
          pendingContext.current = combined;
          // The server generates from this exact config, so later edits must invalidate the proposal.
          append({ role: "assistant", text: response.explanation });
          const selected = response.candidates[0]?.id;
          if (selected) {
            setResult({ ...response, before: structuredClone(config), key: currentKey, scope: scopeKey }); setTarget(selected);
            const proposed = await propose({ id: response.id, target: selected, instruction: combined, imageIds, media });
            if (!alive.current) return;
            setProposal({ ...proposed, before: structuredClone(config), context: combined, key: currentKey, scope: scopeKey });
          }
        }
        failed.current = undefined;
      } catch (e) { failed.current = text; if (alive.current) setInstruction(current => current || text); throw e; }
    });
  }
  const trigger = <button className={`${triggerHost ? "editor-pen-button" : ""}${image ? " selected" : ""}`} aria-pressed={!!image} title={image ? tr("ペンをやめてプレビューに戻る") : tr("この画面を修正する")} disabled={locked} onClick={() => chatPanel.collapsed ? chatPanel.expand() : image ? close() : void capture()}><svg className="editor-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg>{image && !chatPanel.collapsed ? tr("修正をやめる") : tr("修正する")}</button>;
  const historyControls = <div className="visual-edit-history" role="group" aria-label={tr("修正履歴")}>
    <button type="button" disabled={locked || history.scope !== scopeKey || history.index === 0} aria-label={tr("前の状態に戻る")} onClick={() => moveHistory(-1)}><span aria-hidden="true">←</span>{tr("戻る")}</button>
    <span className="small muted" aria-live="polite">{history.index + 1} / {history.entries.length}</span>
    <button type="button" disabled={locked || history.scope !== scopeKey || history.index >= history.entries.length - 1} aria-label={tr("次の状態に進む")} onClick={() => moveHistory(1)}>{tr("進む")}<span aria-hidden="true">→</span></button>
  </div>;
  return <>
    {triggerHost && createPortal(<>{trigger}{!historyHost && !open && history.entries.length > 1 && historyControls}</>, triggerHost)}
    {triggerHost && historyHost && !open && history.entries.length > 1 && createPortal(historyControls, historyHost)}
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
    {chatPanel.restoreButton}
    {open && createPortal(<aside id={chatPanel.panelId} tabIndex={-1} hidden={!chatPanel.expanded} className="visual-chat-panel" aria-label={tr("画面の修正チャット")} data-capture-ignore>
      <div className="visual-chat-heading"><div><h3>{tr("画面の修正")}</h3><p className="small muted">{screen?.label}</p></div><div className="chat-panel-heading-actions">{chatPanel.collapseButton}<button type="button" disabled={locked} aria-label={tr("閉じる")} onClick={close}>×</button></div></div>
      <p className="small">{tr("赤ペンで囲むか、変えたいことをそのまま書いてください。")}</p>
      <div className="visual-chat-view">{historyControls}<button type="button" className="text-button" disabled={locked} onClick={() => image ? clearCapture() : void capture()}>{image ? tr("画面を操作する") : tr("赤ペンで囲む")}</button></div>
      <div ref={log} className="chat-log visual-chat-log" role="log" aria-label={tr("画面の修正の会話")} aria-live="polite">
        {messages.map((message, index) => <article key={index} className={`chat-message chat-message-${message.role}`}><b>{message.role === "user" ? tr("あなた") : "AI"}</b><div className="pre-wrap">{message.text}</div>{!!message.imageIds?.length && <div className="chat-message-images">{message.imageIds.map((id, i) => <MenuImage key={id} imageId={id} imageBase={`/api/shops/${shopId}/menu-images`} name={tr("添付画像{0}", i + 1)} className="chat-message-image" />)}</div>}</article>)}
        {error && <p className="alert" role="alert">{error}</p>}
      </div>
      {busy && work && !proposal && <VisualGenerationStatus shopId={shopId} work={work} />}
      <form className="chat-composer" aria-label={tr("ペンで囲んだ箇所への依頼")} onSubmit={event => { event.preventDefault(); void submitRequest(); }}>
        <textarea ref={composer} aria-label={tr("ここをどう変えたいですか")} aria-keyshortcuts="Control+Enter Meta+Enter" onKeyDown={event => submitOnShortcut(event)} rows={3} maxLength={4000} disabled={locked} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={tr("ここを『季節を楽しむネイル』に変えて")} />
        <div className="chat-composer-toolbar">
          <RequestImagePicker shopId={shopId} value={imageIds} disabled={locked || listening} label={tr("画像を添付")} onChange={ids => { setImageIds(ids); setResult(undefined); }} />
          <DictationButton onListening={setListening} value={instruction} onChange={setInstruction} onSend={value => void submitRequest(value)} stopRef={stopDictation} disabled={locked} />
          <button type="submit" className="primary chat-send" disabled={locked || listening || !instruction.trim()}>{busy ? tr("確認しています…") : tr("送信")}</button>
        </div>
      </form>
    </aside>, document.body)}
    {proposal && <VisualChangeReview progress={work && <VisualGenerationStatus shopId={shopId} work={work} />} reviewed={proposal.visualReview?.approved} before={renderPreview?.(proposal.before)} after={renderPreview?.(proposal.config)} summary={proposal.summary} busy={locked} canAccept={proposalIsCurrent} error={proposalIsCurrent ? error : tr("編集中の内容が変わりました。修正案をキャンセルして依頼し直してください。")} onCancel={() => {
      discardProposal();
      append({ role: "assistant", text: tr("修正案をキャンセルしました。変更前の内容を保持しています。") });
    }} onAccept={() => {
      if (locked || !proposalIsCurrent) return;
      remember({ config: proposal.config }); onLocalChange(proposal.config);
      discardProposal();
      append({ role: "assistant", text: tr("画面を更新しました。まだ本番には反映していません。") });
    }} onRefine={async instruction => {
      if (!result || !proposalIsCurrent) return false;
      let success = false;
      await run(async () => {
        const next = await propose({ id: result.id, target, instruction, messages: messages.map(({ role, text }) => ({ role, text })), applied: proposal.context, imageIds, media: submittedMedia.current, revision: proposal.config });
        if (!alive.current) return;
        setProposal({ ...proposal, ...next, context: [proposal.context, instruction].join("\n\n").slice(-4000) });
        append({ role: "user", text: instruction });
        success = true;
      });
      return success;
    }} />}
  </>;
}
