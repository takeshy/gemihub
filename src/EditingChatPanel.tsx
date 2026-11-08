import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { tr } from "../shared/i18n";
import { useChatPanelCollapse } from "./ChatPanelCollapse";

/** Shares the red-pen editor's panel, responsive layout and keyboard entry point. */
export function EditingChatPanel({ open, title, onClose, children, reopenSignal = 0 }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; reopenSignal?: number;
}) {
  const panel = useRef<HTMLElement>(null);
  const chat = useChatPanelCollapse(open, title, reopenSignal);
  useEffect(() => {
    if (!chat.expanded) return;
    document.body.classList.add("visual-chat-open");
    panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    return () => document.body.classList.remove("visual-chat-open");
  }, [chat.expanded]);
  return <>{chat.restoreButton}{createPortal(<aside id={chat.panelId} tabIndex={-1} ref={panel} hidden={!chat.expanded} className="visual-chat-panel shop-change-chat" aria-label={tr("ページ追加・機能変更のチャット")} onKeyDown={event => { if (event.target instanceof Element && event.target.closest("dialog")) return; if (event.key === "Escape" && !event.nativeEvent.isComposing && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="visual-chat-heading"><h3>{title}</h3><div className="chat-panel-heading-actions">{chat.collapseButton}<button type="button" aria-label={tr("閉じる")} onClick={onClose}>×</button></div></div>
    {children}
  </aside>, document.body)}</>;
}
