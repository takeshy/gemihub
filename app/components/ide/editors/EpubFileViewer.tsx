// IDE viewer for .epub files: the ZIP is unpacked client-side into one
// self-contained HTML document (app/utils/epub.ts) shown in a sandboxed
// iframe, with font-size / page-width steppers and the per-document memo
// timeline — the same reading experience as the dashboard File widget.

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { useBinaryFile } from "~/hooks/useBinaryFile";
import { HtmlDocumentFrame } from "~/dashboard/widgets/file-widget/HtmlDocumentFrame";
import { ScaleStepper } from "~/dashboard/widgets/file-widget/ScaleStepper";
import { IdeDocumentMemo } from "./IdeDocumentMemo";

const FONT_SCALE_MIN = 70;
const FONT_SCALE_MAX = 240;
const WIDTH_SCALE_MIN = 70;
const WIDTH_SCALE_MAX = 180;

export function EpubFileViewer({ fileId, fileName }: { fileId: string; fileName: string }) {
  const { t } = useI18n();
  const editorCtx = useEditorContext();
  // Memo files are keyed by the document's Drive path (same identity the
  // dashboard File widget uses), so resolve it from the file list.
  const fileEntry = editorCtx.fileList.find((f) => f.id === fileId);
  const memoDrivePath = fileEntry ? fileEntry.path || fileEntry.name : fileName;

  const { bytes, error, loading } = useBinaryFile(fileId, true, t("mainViewer.loadError"));
  const [epubHtml, setEpubHtml] = useState("");
  const [epubError, setEpubError] = useState("");
  const [fontScale, setFontScale] = useState(100);
  const [widthScale, setWidthScale] = useState(100);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [frameLoadTick, setFrameLoadTick] = useState(0);

  useEffect(() => {
    setEpubHtml("");
    setEpubError("");
    if (!bytes) return;
    let cancelled = false;
    (async () => {
      try {
        const { epubToHtml } = await import("~/utils/epub");
        const html = await epubToHtml(bytes, fileName);
        if (!cancelled) setEpubHtml(html);
      } catch (convertError) {
        console.error(convertError);
        if (!cancelled) setEpubError(t("mainViewer.loadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, fileName]);

  return (
    <IdeDocumentMemo
      drivePath={memoDrivePath}
      kind="epub"
      frameRef={frameRef}
      frameLoadTick={frameLoadTick}
      refreshSignals={[epubHtml, fontScale, widthScale]}
    >
      {({ memoToggle }) => (
        <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-1 dark:border-gray-800 dark:bg-gray-900">
            <span className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-400">{fileName}</span>
            <div className="flex shrink-0 items-center gap-2">
              {memoToggle}
              <ScaleStepper
                value={fontScale}
                min={FONT_SCALE_MIN}
                max={FONT_SCALE_MAX}
                title={t("dashboard.fileFontSize")}
                onChange={setFontScale}
              />
              <ScaleStepper
                value={widthScale}
                min={WIDTH_SCALE_MIN}
                max={WIDTH_SCALE_MAX}
                title={t("dashboard.fileWidth")}
                onChange={setWidthScale}
              />
            </div>
          </div>
          {error || epubError ? (
            <div className="flex flex-1 items-center justify-center p-4 text-sm text-red-500">{error || epubError}</div>
          ) : loading || !epubHtml ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : (
            <HtmlDocumentFrame
              content={epubHtml}
              title={fileName}
              fontScale={fontScale}
              widthScale={widthScale}
              frameRef={frameRef}
              onFrameLoad={() => setFrameLoadTick((value) => value + 1)}
            />
          )}
        </div>
      )}
    </IdeDocumentMemo>
  );
}
