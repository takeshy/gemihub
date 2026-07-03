// A lightweight preview modal used by the File List widget: clicking a file
// shows its content here first, with a navigate icon (open the file in the
// editor) and a close icon in the header — instead of navigating immediately.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X, Loader2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { isMarkdownFile } from "~/utils/frontmatter";
import GfmMarkdownPreview from "~/components/ide/GfmMarkdownPreview";
import { splitFrontmatter } from "../frontmatter-writeback";
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

export function FilePreviewModal({
  fileId,
  fileName,
  onNavigate,
  onClose,
}: {
  fileId: string;
  fileName: string;
  /** Open the file in the editor (the actual navigation). */
  onNavigate: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const kind = mediaKind(fileName);

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
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
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
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {kind ? (
            <BinaryPreviewBody fileId={fileId} fileName={fileName} kind={kind} />
          ) : (
            <TextPreviewBody fileId={fileId} fileName={fileName} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TextPreviewBody({ fileId, fileName }: { fileId: string; fileName: string }) {
  const { t } = useI18n();
  const { fileList } = useEditorContext();
  const { content, loading } = useFileWithCache(fileId, undefined, "FileListPreview");
  const currentFilePath = fileList.find((file) => file.id === fileId)?.path || fileName;

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
  if (isMarkdownFile(fileName)) {
    const split = splitFrontmatter(content);
    return (
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <GfmMarkdownPreview content={split ? split.body : content} fileList={fileList} currentFilePath={currentFilePath} />
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
