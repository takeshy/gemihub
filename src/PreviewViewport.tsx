import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../shared/i18n";
import { PreviewViewportContext } from "./preview-viewport-context";

/** A real viewport makes authored media queries match the phone, not the owner's desktop. */
export function PreviewViewport({ children }: { children: React.ReactNode }) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [mount, setMount] = useState<HTMLElement>();
  useEffect(() => {
    if (!frame?.contentDocument) return;
    let active = true;
    const doc = frame.contentDocument;
    doc.open();doc.write('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="preview-viewport-content"></div></body></html>');doc.close();
    doc.documentElement.lang = document.documentElement.lang;
    const base = doc.createElement("base");base.href = document.baseURI;doc.head.append(base);
    const styles = [...document.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"],style')].map(source => {
      const copy = source.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
      const loaded = source.tagName === "LINK" ? new Promise<void>(resolve => { copy.addEventListener("load", () => resolve(), { once: true });copy.addEventListener("error", () => resolve(), { once: true }); }) : Promise.resolve();
      if (source.tagName === "LINK") (copy as HTMLLinkElement).href = (source as HTMLLinkElement).href;
      doc.head.append(copy);return loaded;
    });
    const style = doc.createElement("style");style.textContent = "html,body{margin:0;padding:0;min-width:0}.comparison-preview{max-height:none;overflow:visible}";doc.head.append(style);
    void Promise.all(styles).then(() => { if (active) setMount(doc.getElementById("preview-viewport-content")!); });
    return () => { active = false; };
  }, [frame]);
  return <><iframe ref={setFrame} title={tr("スマートフォン")} className="preview-viewport" data-preview-viewport data-preview-ready={mount ? "true" : undefined} />{mount && createPortal(<PreviewViewportContext.Provider value>{children}</PreviewViewportContext.Provider>, mount)}</>;
}
