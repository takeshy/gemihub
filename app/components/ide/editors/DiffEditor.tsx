import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Loader2, X } from "lucide-react";
import { createTwoFilesPatch } from "diff";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import { DiffView } from "~/components/shared/DiffView";
import { getCachedFile } from "~/services/indexeddb-cache";

export interface DiffEditorProps {
  fileId: string;
  fileName: string;
  currentContent: string;
  targetFileId: string;
  targetFileName: string;
  saveToCache: (content: string) => Promise<void>;
  onClose: () => void;
}

export function DiffEditor({
  fileId,
  fileName,
  currentContent,
  targetFileId,
  targetFileName,
  saveToCache,
  onClose,
}: DiffEditorProps) {
  const { t } = useI18n();
  const [content, setContent] = useState(currentContent);
  const [targetContent, setTargetContent] = useState<string | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(true);

  // Debounced auto-save
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setContent(newContent);
  }, []);

  // Sync content when parent's currentContent changes (e.g. external save)
  useEffect(() => {
    contentFromProps.current = true;
    setContent(currentContent);
  }, [currentContent]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = content;
    debounceRef.current = setTimeout(() => {
      saveToCache(content);
      pendingContentRef.current = null;
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, saveToCache, fileId]);

  // Flush pending content on unmount
  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

  // Load target file content
  useEffect(() => {
    let cancelled = false;
    setLoadingTarget(true);

    (async () => {
      // Try IndexedDB cache first
      const cached = await getCachedFile(targetFileId);
      if (!cancelled && cached?.content != null) {
        setTargetContent(cached.content);
        setLoadingTarget(false);
        return;
      }
      // Fallback: fetch via pullDirect
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pullDirect", fileIds: [targetFileId] }),
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          const file = data.files?.[0];
          setTargetContent(file?.content ?? "");
        }
      } catch {
        if (!cancelled) setTargetContent("");
      } finally {
        if (!cancelled) setLoadingTarget(false);
      }
    })();

    return () => { cancelled = true; };
  }, [targetFileId]);

  // Compute diff
  const diff = useMemo(() => {
    if (targetContent === null) return "";
    return createTwoFilesPatch(targetFileName, fileName, targetContent, content);
  }, [content, targetContent, fileName, targetFileName]);

  const flushOnBlur = useCallback(() => {
    if (pendingContentRef.current !== null) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      saveToCache(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [saveToCache]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" onBlur={flushOnBlur}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
          {fileName} vs {targetFileName}
        </span>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X size={ICON.SM} />
          {t("editHistory.close")}
        </button>
      </div>

      {/* Split view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top: editable textarea */}
        <div className="flex-1 min-h-0 p-4">
          <textarea
            value={content}
            onChange={(e) => updateContent(e.target.value)}
            className="w-full h-full font-mono text-xs leading-none bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
            spellCheck={false}
          />
        </div>

        {/* Bottom: diff view */}
        <div className="flex-1 min-h-0 overflow-auto border-t border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
          {loadingTarget ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : (
            <DiffView diff={diff} />
          )}
        </div>
      </div>
    </div>
  );
}
