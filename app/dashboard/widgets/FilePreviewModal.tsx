// A file modal shared by the dashboard widgets (file list, kanban, base,
// timeline): clicking a file shows it here first, with a navigate icon (open
// the file in the editor) and a close icon in the header — instead of
// navigating immediately. Markdown files open in the full MarkdownFileEditor
// (preview / wysiwyg / raw modes, local-first saves); other text and media
// stay read-only previews.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X, Loader2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { isMarkdownFile } from "~/utils/frontmatter";
import { MarkdownFileEditor, type MdEditMode } from "~/components/ide/editors/MarkdownFileEditor";
import { getCachedFile, setCachedFile } from "~/services/indexeddb-cache";
import { bytesToBase64, base64ToBytes, guessMimeType } from "~/utils/media-utils";

type MediaKind = "image" | "audio" | "video" | "pdf";

function mediaKind(name: string): MediaKind | null {
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(name)) return "image";
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return "audio";
  if (/\.(mp4|webm|ogv|mov|m4v)$/i.test(name)) return "video";
  if (/\.pdf$/i.test(name)) return "pdf";
  return null;
}

// Session-remembered mode for the modal's markdown editor (preview-first on
// the first open, then the user's last explicit choice) — the FileWidget
// sessionMode pattern.
let modalSessionMode: MdEditMode = "preview";

export function FilePreviewModal({
  fileId,
  fileName,
  initialMode,
  onNavigate,
  onClose,
}: {
  fileId: string;
  fileName: string;
  /** Override the first markdown editor mode for this open. */
  initialMode?: MdEditMode;
  /** Open the file in the editor (the actual navigation). */
  onNavigate: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const kind = mediaKind(fileName);
  const editable = !kind && isMarkdownFile(fileName);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayName = fileName.includes("/")
    ? fileName.slice(fileName.lastIndexOf("/") + 1)
    : fileName;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900${editable ? " h-[85vh]" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">
            {displayName}
          </span>
          <button
            type="button"
            onClick={onNavigate}
            title={t("dashboard.openFile")}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <ExternalLink size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t("common.close")}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>
        {editable ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <MarkdownEditorBody fileId={fileId} fileName={fileName} initialMode={initialMode} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {kind ? (
              <BinaryPreviewBody fileId={fileId} fileName={fileName} kind={kind} />
            ) : (
              <TextPreviewBody fileId={fileId} />
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Editable body for Markdown files — the file widget's editor in a modal. */
function MarkdownEditorBody({ fileId, fileName, initialMode }: { fileId: string; fileName: string; initialMode?: MdEditMode }) {
  const { t } = useI18n();
  const { fileList } = useEditorContext();
  const { content, loading, saveToCache } = useFileWithCache(fileId, undefined, "FilePreviewModal");
  const currentFilePath = fileList.find((file) => file.id === fileId)?.path || fileName;
  const skipInitialModeNotifyRef = useRef(Boolean(initialMode));

  // Local-first save (IndexedDB + editHistory; Drive on Push) plus a data
  // signal so folder widgets (kanban/file list/timeline) reflect the edit.
  const saveAndNotify = useCallback(
    async (next: string) => {
      await saveToCache(next);
      const folder = currentFilePath.includes("/")
        ? currentFilePath.slice(0, currentFilePath.lastIndexOf("/"))
        : "";
      window.dispatchEvent(new CustomEvent("dashboard-data-changed", { detail: { folder } }));
    },
    [saveToCache, currentFilePath],
  );

  if (content == null) {
    return loading ? (
      <div className="flex h-40 items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    ) : (
      <div className="flex h-40 items-center justify-center text-sm text-gray-400">
        {t("dashboard.fileNotFound")}
      </div>
    );
  }
  return (
    <MarkdownFileEditor
      key={fileId}
      fileId={fileId}
      fileName={currentFilePath}
      initialContent={content}
      saveToCache={saveAndNotify}
      hideToolbarActions
      initialMode={initialMode ?? modalSessionMode}
      onModeChange={(mode) => {
        if (skipInitialModeNotifyRef.current) {
          skipInitialModeNotifyRef.current = false;
          return;
        }
        modalSessionMode = mode;
      }}
    />
  );
}

function TextPreviewBody({ fileId }: { fileId: string }) {
  const { t } = useI18n();
  const { content, loading } = useFileWithCache(fileId, undefined, "FileListPreview");

  if (loading && content == null) {
    return (
      <div className="flex h-40 items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }
  if (content == null) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-gray-400">
        {t("dashboard.fileNotFound")}
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800 dark:text-gray-200">
      {content}
    </pre>
  );
}

function BinaryPreviewBody({ fileId, fileName, kind }: { fileId: string; fileName: string; kind: MediaKind }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const show = (buf: ArrayBuffer) => {
      const blob = new Blob([buf], { type: guessMimeType(fileName) });
      objectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setSrc(objectUrl);
    };
    (async () => {
      const cached = await getCachedFile(fileId);
      if (cancelled) return;
      if (cached?.encoding === "base64" && cached.content) {
        show(base64ToBytes(cached.content).buffer as ArrayBuffer);
        return;
      }
      try {
        const res = await fetch(`/api/drive/files?action=raw&fileId=${encodeURIComponent(fileId)}`);
        if (!res.ok || cancelled) {
          if (!cancelled) setError(t("mainViewer.loadError"));
          return;
        }
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        await setCachedFile({
          fileId,
          content: bytesToBase64(new Uint8Array(buf)),
          md5Checksum: cached?.md5Checksum ?? "",
          modifiedTime: cached?.modifiedTime ?? "",
          cachedAt: Date.now(),
          fileName,
          encoding: "base64",
        });
        show(buf);
      } catch {
        if (!cancelled) setError(t("mainViewer.offlineNoCache"));
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, fileName, t]);

  if (error) return <div className="flex h-40 items-center justify-center text-sm text-gray-400">{error}</div>;
  if (!src) return <div className="flex h-40 items-center justify-center text-gray-400"><Loader2 size={20} className="animate-spin" /></div>;
  if (kind === "image") return <img src={src} alt={fileName} className="mx-auto max-h-[70vh] max-w-full rounded-md object-contain" />;
  if (kind === "audio") return <audio src={src} controls className="w-full" />;
  if (kind === "video") return <video src={src} controls className="max-h-[70vh] w-full rounded-md" />;
  return <iframe src={src} title={fileName} className="h-[70vh] w-full border-0" />;
}
