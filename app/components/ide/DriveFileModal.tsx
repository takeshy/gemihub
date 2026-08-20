import { useEffect, useMemo, useRef, useState } from "react";
import { Download, HardDrive, Loader2, X } from "lucide-react";
import { FrontmatterEditor, parseFrontmatter } from "~/components/editor/FrontmatterEditor";
import GfmMarkdownPreview from "~/components/ide/GfmMarkdownPreview";
import { HtmlDocumentFrame } from "~/dashboard/widgets/file-widget/HtmlDocumentFrame";
import { useI18n } from "~/i18n/context";
import { isBinaryMimeType } from "~/services/sync-client-utils";
import { ICON } from "~/utils/icon-sizes";

export interface DriveModalFile {
  fileId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
}

function isMarkdown(file: DriveModalFile): boolean {
  return file.mimeType === "text/markdown" || /\.(md|markdown)$/i.test(file.fileName);
}

function isText(file: DriveModalFile): boolean {
  return !isBinaryMimeType(file.mimeType) &&
    !file.mimeType.startsWith("application/vnd.google-apps.") &&
    !/\.(png|jpe?g|gif|webp|pdf|epub|zip|mp3|mp4|webm)$/i.test(file.fileName);
}

function DriveEpubPreview({ file, rawUrl }: { file: DriveModalFile; rawUrl: string }) {
  const { t } = useI18n();
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml("");
    setError("");
    void fetch(rawUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const { epubToHtml } = await import("~/utils/epub");
        const converted = await epubToHtml(bytes, file.fileName);
        if (!cancelled) setHtml(converted);
      })
      .catch(() => { if (!cancelled) setError(t("mainViewer.loadError")); });
    return () => { cancelled = true; };
  }, [file.fileName, rawUrl, t]);

  if (error) return <div className="flex items-center justify-center p-4 text-sm text-red-500">{error}</div>;
  if (!html) return <div className="flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>;
  return (
    <HtmlDocumentFrame
      content={html}
      title={file.fileName}
      fontScale={100}
      widthScale={100}
      frameRef={frameRef}
      onFrameLoad={() => undefined}
    />
  );
}

export function DriveFileModal({ file, onClose }: { file: DriveModalFile; onClose: () => void }) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(isText(file));
  const [error, setError] = useState<string | null>(null);
  const [markdownMode, setMarkdownMode] = useState<"preview" | "raw">("preview");
  const parsedMarkdown = useMemo(() => parseFrontmatter(content), [content]);

  useEffect(() => {
    if (!isText(file)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ mount: "drive", action: "read", fileId: file.fileId });
    void fetch(`/api/drive/files?${params}`)
      .then(async (response) => {
        const data = await response.json() as { content?: string; error?: string };
        if (!response.ok || typeof data.content !== "string") throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setContent(data.content);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("driveModal.loadFailed"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, t]);

  useEffect(() => setMarkdownMode("preview"), [file.fileId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const rawUrl = `/api/drive/files?${new URLSearchParams({ mount: "drive", action: "raw", fileId: file.fileId })}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-2 sm:p-5" role="dialog" aria-modal="true" aria-label={file.fileName}>
      <div className="flex h-full max-h-[900px] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex min-h-11 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-700">
          <HardDrive size={ICON.MD} className="shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{file.fileName}</div>
            <div className="truncate text-[10px] text-gray-400">{t("driveModal.myDrive")} · {file.filePath}</div>
          </div>
          {isMarkdown(file) && (
            <div className="flex shrink-0 rounded border border-gray-200 p-0.5 text-xs dark:border-gray-700">
              <button
                type="button"
                onClick={() => setMarkdownMode("preview")}
                className={`rounded px-2 py-1 ${markdownMode === "preview" ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100" : "text-gray-500"}`}
              >
                {t("mainViewer.preview")}
              </button>
              <button
                type="button"
                onClick={() => setMarkdownMode("raw")}
                className={`rounded px-2 py-1 ${markdownMode === "raw" ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100" : "text-gray-500"}`}
              >
                {t("mainViewer.raw")}
              </button>
            </div>
          )}
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label={t("conflict.close")}>
            <X size={ICON.LG} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 bg-white dark:bg-gray-950 [&>*]:min-w-0 [&>*]:flex-1">
          {loading ? (
            <div className="flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>
          ) : error ? (
            <div className="p-6 text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : isMarkdown(file) && markdownMode === "preview" ? (
            <div className="overflow-auto">
              {parsedMarkdown.hasFrontmatter && (
                <FrontmatterEditor parsed={parsedMarkdown} onFrontmatterChange={() => undefined} readOnly initialCollapsed={false} />
              )}
              <div className="prose max-w-none p-5 dark:prose-invert [&_p]:my-1 [&_p]:leading-relaxed">
                <GfmMarkdownPreview content={parsedMarkdown.hasFrontmatter ? parsedMarkdown.body : content} />
              </div>
            </div>
          ) : isText(file) ? (
            <pre className="overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm text-gray-900 dark:text-gray-100">{content}</pre>
          ) : file.mimeType.startsWith("image/") ? (
            <div className="flex items-center justify-center overflow-auto bg-gray-100 p-4 dark:bg-gray-950"><img src={rawUrl} alt={file.fileName} className="max-h-full max-w-full object-contain" /></div>
          ) : file.mimeType === "application/pdf" || file.fileName.toLowerCase().endsWith(".pdf") ? (
            <iframe src={rawUrl} title={file.fileName} className="h-full w-full border-0" />
          ) : file.fileName.toLowerCase().endsWith(".epub") || file.mimeType === "application/epub+zip" ? (
            <DriveEpubPreview file={file} rawUrl={rawUrl} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-sm text-gray-500">
              <span>{t("driveModal.previewUnavailable")}</span>
              <a href={`${rawUrl}&download=1`} className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                <Download size={ICON.SM} />{t("driveModal.download")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
