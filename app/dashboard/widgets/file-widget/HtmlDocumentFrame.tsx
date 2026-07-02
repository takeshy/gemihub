// Sandboxed iframe for HTML and EPUB documents (ported from mdwys).
// Font size and content width are injected as CSS custom props + an override
// style into the frame document. `allow-same-origin` (without allow-scripts)
// keeps contentDocument reachable for memo anchoring while EPUB scripts are
// already stripped by epubToHtml.

import { useCallback, useEffect, useState } from "react";

export function HtmlDocumentFrame({
  content,
  title,
  fontScale,
  widthScale,
  frameRef,
  onFrameLoad,
}: {
  content: string;
  title: string;
  fontScale: number;
  widthScale: number;
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  onFrameLoad: () => void;
}) {
  const [url, setUrl] = useState("");
  const contentWidth = `${Math.round((1120 * widthScale) / 100)}px`;

  useEffect(() => {
    if (!content) {
      setUrl("");
      return;
    }
    const blob = new Blob([content], { type: "text/html;charset=utf-8" });
    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [content]);

  const applyViewAdjustments = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;

    doc.documentElement.style.setProperty("--view-font-scale", `${fontScale}%`);
    doc.documentElement.style.setProperty("--view-content-width", contentWidth);
    const styleId = "gemihub-view-adjustments";
    const style = doc.getElementById(styleId) ?? doc.createElement("style");
    style.id = styleId;
    style.textContent = `
      html { font-size: ${fontScale}% !important; }
      body {
        font-size: 1rem !important;
        line-height: 1.75 !important;
        padding-left: clamp(12px, 2vw, 28px) !important;
        padding-right: clamp(12px, 2vw, 28px) !important;
      }
      .epub-book {
        width: min(100%, ${contentWidth}) !important;
        max-width: none !important;
      }
    `;
    if (!style.parentNode) {
      doc.head.appendChild(style);
    }
  }, [contentWidth, fontScale, frameRef]);

  useEffect(() => {
    applyViewAdjustments();
  }, [applyViewAdjustments]);

  if (!url) return null;

  return (
    <iframe
      ref={frameRef}
      className="h-full w-full border-0 bg-white"
      src={url}
      title={title}
      sandbox="allow-same-origin allow-popups"
      onLoad={() => {
        applyViewAdjustments();
        onFrameLoad();
      }}
      style={{
        ["--view-font-scale" as string]: `${fontScale}%`,
        ["--view-content-width" as string]: contentWidth,
      }}
    />
  );
}
