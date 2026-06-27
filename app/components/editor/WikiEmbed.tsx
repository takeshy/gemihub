import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import { getCachedFile, setCachedFile } from "~/services/indexeddb-cache";
import { parseFrontmatter } from "~/components/editor/FrontmatterEditor";
import { bytesToBase64, base64ToBytes, guessMimeType } from "~/utils/media-utils";
import { extractMarkdownSubpath } from "~/utils/wiki-subpath";
import { resolveWikiTarget } from "./WikiLinkPreview";
import type { FileListItem } from "~/contexts/EditorContext";
import type { TranslationStrings } from "~/i18n/translations";

const LazyGfmPreview = lazy(() => import("~/components/ide/GfmMarkdownPreview"));

type MediaKind = "image" | "audio" | "video" | "pdf";

function mediaKind(name: string): MediaKind | null {
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(name)) return "image";
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return "audio";
  if (/\.(mp4|webm|ogv|mov|m4v)$/i.test(name)) return "video";
  if (/\.pdf$/i.test(name)) return "pdf";
  return null;
}

function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/** Parse an embed spec `target#subpath|640x480` into its parts. */
function parseEmbedSpec(spec: string): {
  target: string;
  subpath?: string;
  width?: number;
  height?: number;
} {
  const pipe = spec.lastIndexOf("|");
  const beforePipe = pipe >= 0 ? spec.slice(0, pipe) : spec;
  const display = pipe >= 0 ? spec.slice(pipe + 1).trim() : "";
  const hash = beforePipe.indexOf("#");
  const target = (hash >= 0 ? beforePipe.slice(0, hash) : beforePipe).trim();
  const subpath = hash >= 0 ? beforePipe.slice(hash + 1).trim() : undefined;
  const size = display.match(/^(\d+)(?:x(\d+))?$/);
  return {
    target,
    subpath: subpath || undefined,
    width: size ? Number(size[1]) : undefined,
    height: size?.[2] ? Number(size[2]) : undefined,
  };
}

/** Load a binary file from cache (or fetch+cache) and expose a blob URL. */
function useFileBlobUrl(file: FileListItem): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const setBlob = (buf: ArrayBuffer) => {
      const blob = new Blob([buf], { type: guessMimeType(file.name) });
      const url = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      blobUrlRef.current = url;
      setSrc(url);
    };
    (async () => {
      const cached = await getCachedFile(file.id);
      if (cancelled) return;
      if (cached?.encoding === "base64" && cached.content) {
        setBlob(base64ToBytes(cached.content).buffer as ArrayBuffer);
        return;
      }
      try {
        const res = await fetch(`/api/drive/files?action=raw&fileId=${file.id}`);
        if (cancelled || !res.ok) return;
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        await setCachedFile({
          fileId: file.id,
          content: bytesToBase64(new Uint8Array(buf)),
          md5Checksum: "",
          modifiedTime: new Date().toISOString(),
          cachedAt: Date.now(),
          fileName: file.name,
          encoding: "base64",
        });
        setBlob(buf);
      } catch {
        // offline, no cache — leave src null
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [file.id, file.name]);

  return src;
}

function EmbeddedMedia({
  file,
  kind,
  width,
  height,
}: {
  file: FileListItem;
  kind: MediaKind;
  width?: number;
  height?: number;
}) {
  const src = useFileBlobUrl(file);
  const [previewOpen, setPreviewOpen] = useState(false);
  const navigate = () => {
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId: file.id, fileName: file.path || file.name, mimeType: guessMimeType(file.name) },
      }),
    );
  };
  if (!src) return <span>…</span>;
  if (kind === "image") {
    return (
      <>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="inline-block max-w-full cursor-zoom-in rounded p-0 text-left"
          title={file.path || file.name}
        >
          <img
            src={src}
            width={width}
            height={height}
            alt={file.name}
            className="max-h-64 max-w-full rounded-md object-contain"
          />
        </button>
        {previewOpen && (
          <ImagePreviewModal
            src={src}
            fileName={file.path || file.name}
            onNavigate={() => {
              navigate();
              setPreviewOpen(false);
            }}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </>
    );
  }
  if (kind === "audio") {
    return <audio src={src} controls />;
  }
  if (kind === "video") {
    return <video src={src} controls width={width} height={height} />;
  }
  // pdf
  return (
    <iframe
      src={src}
      title={file.name}
      width={width ?? "100%"}
      height={height ?? 480}
      style={{ border: 0 }}
    />
  );
}

function ImagePreviewModal({
  src,
  fileName,
  onNavigate,
  onClose,
}: {
  src: string;
  fileName: string;
  onNavigate: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayName = fileName.includes("/") ? fileName.slice(fileName.lastIndexOf("/") + 1) : fileName;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
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
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            title="Open"
          >
            <ExternalLink size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <img src={src} alt={displayName} className="mx-auto max-h-[70vh] max-w-full rounded-md object-contain" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function EmbeddedMarkdown({ file, subpath }: { file: FileListItem; subpath?: string }) {
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedFile(file.id);
      if (cancelled) return;
      const fullBody = parseFrontmatter(cached?.content ?? "").body;
      setBody(extractMarkdownSubpath(fullBody, subpath));
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id, subpath]);

  if (body === null) return <span>…</span>;
  return (
    // Always a light-themed card: the WYSIWYG editor is forced light while the
    // app may still carry a `dark` class, so dark:prose-invert would wash the
    // text out to gray on white. A fixed light card reads well in both modes.
    <div className="prose prose-sm max-w-none rounded border border-gray-200 bg-white text-gray-900 p-3">
      <Suspense fallback={<span>…</span>}>
        {/* No fileList passed: nested embeds/links stay as text (depth-1 guard) */}
        <LazyGfmPreview content={body} />
      </Suspense>
    </div>
  );
}

/**
 * Inline renderer for an internal embed (`![[spec]]`) used by wysimark-lite's
 * renderInternalEmbed hook. Resolves the spec to a cached file and renders the
 * appropriate media (image/audio/video/pdf) or the markdown body for notes.
 */
export function WikiEmbed({
  spec,
  fileList,
  t,
}: {
  spec: string;
  fileList: FileListItem[];
  t: (key: keyof TranslationStrings) => string;
}) {
  const { target, subpath, width, height } = parseEmbedSpec(spec);
  const file = resolveWikiTarget(fileList, target);

  if (!file) {
    return <span style={{ fontStyle: "italic" }}>{t("wikiPreview.notFound")}</span>;
  }
  const kind = mediaKind(file.name);
  if (kind) {
    return <EmbeddedMedia file={file} kind={kind} width={width} height={height} />;
  }
  if (isMarkdownName(file.name)) {
    return <EmbeddedMarkdown file={file} subpath={subpath} />;
  }
  return <span>{file.name}</span>;
}
