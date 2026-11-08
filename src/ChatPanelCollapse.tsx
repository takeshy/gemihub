import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../shared/i18n";

/** Folding changes visibility only; the mounted chat keeps its conversation, draft and work. */
export function useChatPanelCollapse(open: boolean, title: string, reopenSignal = 0) {
  const [collapsed, setCollapsed] = useState(false);
  const panelId = useId();
  const restore = useRef<HTMLButtonElement>(null);
  useEffect(() => { setCollapsed(false); }, [open, reopenSignal]);
  function expand() {
    setCollapsed(false);
    requestAnimationFrame(() => {
      const panel = document.getElementById(panelId);
      (panel?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)") || panel)?.focus({ preventScroll: true });
    });
  }
  const collapseButton = <button type="button" className="chat-panel-collapse" aria-label={tr("チャットを折り畳む")} aria-expanded="true" aria-controls={panelId} onClick={() => {
    setCollapsed(true);
    requestAnimationFrame(() => restore.current?.focus({ preventScroll: true }));
  }}><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 5 7 7-7 7" /></svg><span>{tr("折り畳む")}</span></button>;
  const restoreButton = open && collapsed ? createPortal(<button ref={restore} type="button" className="chat-panel-restore" aria-label={tr("{0}のチャットを開く", title)} aria-expanded="false" aria-controls={panelId} onClick={expand}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 5-7 7 7 7" /></svg>{tr("チャットを開く")}
  </button>, document.body) : null;
  return { collapsed, expanded: open && !collapsed, panelId, expand, collapseButton, restoreButton };
}
