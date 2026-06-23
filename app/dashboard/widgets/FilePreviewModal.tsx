// A lightweight preview modal used by the File List widget: clicking a file
// shows its content here first, with a navigate icon (open the file in the
// editor) and a close icon in the header — instead of navigating immediately.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X, Loader2 } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { useFileWithCache } from "~/hooks/useFileWithCache";
import { isMarkdownFile } from "~/utils/frontmatter";
import GfmMarkdownPreview from "~/components/ide/GfmMarkdownPreview";
import { splitFrontmatter } from "../frontmatter-writeback";

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
  const { fileList } = useEditorContext();
  const { content, loading } = useFileWithCache(fileId, undefined, "FileListPreview");

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isMd = isMarkdownFile(fileName);
  const displayName = fileName.includes("/")
    ? fileName.slice(fileName.lastIndexOf("/") + 1)
    : fileName;

  let bodyContent: React.ReactNode;
  if (loading && content == null) {
    bodyContent = (
      <div className="flex h-40 items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  } else if (content == null) {
    bodyContent = (
      <div className="flex h-40 items-center justify-center text-sm text-gray-400">
        {t("dashboard.fileNotFound")}
      </div>
    );
  } else if (isMd) {
    const split = splitFrontmatter(content);
    bodyContent = (
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <GfmMarkdownPreview content={split ? split.body : content} fileList={fileList} />
      </div>
    );
  } else {
    bodyContent = (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800 dark:text-gray-200">
        {content}
      </pre>
    );
  }

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
        <div className="min-h-0 flex-1 overflow-auto p-4">{bodyContent}</div>
      </div>
    </div>,
    document.body,
  );
}
