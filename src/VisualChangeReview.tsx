import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../shared/i18n";
import { useComparisonScroll } from "./comparison-scroll";

export function VisualChangeReview({ before, after, summary, busy, error, progress, canAccept = true, reviewed = false, onAccept, onCancel, onRefine }: {
  before: React.ReactNode; after: React.ReactNode; summary: string[]; busy: boolean; error: string;
  onAccept: () => void; onCancel: () => void; onRefine: (instruction: string) => Promise<boolean>;
  canAccept?: boolean;
  reviewed?: boolean;
  progress?: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [refining, setRefining] = useState(false);
  const [instruction, setInstruction] = useState("");
  const syncScroll = useComparisonScroll();
  useEffect(() => { dialog.current?.showModal(); heading.current?.focus(); }, []);
  useEffect(() => {
    if (!refining) return;
    input.current?.focus({ preventScroll: true });
    input.current?.scrollIntoView({ block: "center" });
  }, [refining]);
  return createPortal(<dialog ref={dialog} className="visual-change-review" aria-labelledby="visual-review-heading" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} onClose={event => {
    // Browsers may close a modal despite a prevented cancel; the proposal stays open while a refinement is running.
    if (busy) event.currentTarget.showModal(); else onCancel();
  }}>
    <h2 id="visual-review-heading" ref={heading} tabIndex={-1}>{tr("修正案を比較")}</h2>
    <p>{tr("変更前と修正案を見比べてください。「OK」でローカルに採用します。本番への反映は別の操作です。")}</p>
    {reviewed && <p className="small muted">{tr("修正後のPC・スマートフォンの画面をAIで確認しました。")}</p>}
    {!!summary.length && <ul>{summary.map((line, index) => <li key={index}>{line}</li>)}</ul>}
    <div className="conflict-columns" onScrollCapture={syncScroll}>
      <section aria-label={tr("変更前")}><h3>{tr("変更前")}</h3>{before}</section>
      <section aria-label={tr("修正案")}><h3>{tr("修正案")}</h3>{after}</section>
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {busy && (progress || <p role="status">{tr("修正を確認しています…")}</p>)}
    {refining && <form className="visual-review-refine" onSubmit={event => {
      event.preventDefault(); if (!instruction.trim() || busy) return;
      void onRefine(instruction.trim()).then(success => {
        if (success) { setInstruction("");setRefining(false);heading.current?.focus(); }
      });
    }}>
      <label>{tr("さらに変更したいこと")}<textarea ref={input} rows={3} maxLength={4000} disabled={busy} value={instruction} onChange={event => setInstruction(event.target.value)} /></label>
      <div className="actions">
        <button type="submit" disabled={busy || !instruction.trim()}>{tr("修正案を更新")}</button>
        <button type="button" disabled={busy} onClick={() => { setRefining(false);heading.current?.focus(); }}>{tr("比較に戻る")}</button>
      </div>
    </form>}
    {!refining && <div className="actions visual-review-actions">
      <button type="button" disabled={busy} onClick={onCancel}>{tr("キャンセル")}</button>
      <button type="button" disabled={busy} onClick={() => { setRefining(true); input.current?.focus(); }}>{tr("さらに変更")}</button>
      <button type="button" className="primary" disabled={busy || !canAccept} onClick={onAccept}>OK</button>
    </div>}
  </dialog>, document.body);
}
