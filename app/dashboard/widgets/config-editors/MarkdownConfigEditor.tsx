import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FileText, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { isMarkdownFile } from "~/utils/frontmatter";
import type { ConfigEditorProps } from "../../types";

interface MarkdownConfig {
  content?: string;
  fileId?: string;
  fileName?: string;
}

type Source = "inline" | "file";

/**
 * Markdown config editor. Choose between:
 *  - "new" (inline): edit content with wysimark-lite (same as the main editor).
 *  - "existing file": reference a Drive markdown file; the widget renders its body.
 */
export function MarkdownConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as MarkdownConfig, [config]);
  const content = cfg.content ?? "";
  // Track the selected mode locally. Deriving it solely from cfg.fileId would
  // deadlock: clicking "Existing file" before a file is picked leaves fileId
  // undefined, so the view would snap back to inline and the picker never shows.
  const [source, setSource] = useState<Source>(cfg.fileId ? "file" : "inline");

  const editorCtx = useEditorContext();
  const markdownFiles = useMemo(
    () => editorCtx.fileList.filter((f) => isMarkdownFile(f.name)),
    [editorCtx.fileList],
  );

  // Searchable file picker (chat @-mention style).
  const [query, setQuery] = useState("");
  const [showList, setShowList] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? markdownFiles.filter((f) => (f.path || f.name).toLowerCase().includes(q))
      : markdownFiles;
    return base.slice(0, 50);
  }, [markdownFiles, query]);

  useEffect(() => {
    if (!showList) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowList(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showList]);

  const [MarkdownEditorComponent, setMarkdownEditorComponent] = useState<
    React.ComponentType<{
      value: string;
      onChange: (md: string) => void;
      placeholder?: string;
    }> | null
  >(null);

  useEffect(() => {
    if (source === "inline" && !MarkdownEditorComponent) {
      import("~/components/editor/MarkdownEditor").then((mod) => {
        setMarkdownEditorComponent(() => mod.MarkdownEditor);
      });
    }
  }, [source, MarkdownEditorComponent]);

  const handleContentChange = useCallback(
    (md: string) => {
      onChange({ content: md });
    },
    [onChange],
  );

  const chooseSource = (next: Source) => {
    setSource(next);
    // Switching to inline drops the file reference so the widget renders content.
    if (next === "inline" && cfg.fileId) {
      onChange({ content });
    }
  };

  const selectFile = (id: string, name: string) => {
    onChange({ content, fileId: id, fileName: name });
    setQuery("");
    setShowList(false);
  };

  return (
    <div className="space-y-3">
      {/* Source selector */}
      <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
        <button
          type="button"
          onClick={() => chooseSource("inline")}
          className={`flex-1 px-3 py-1.5 ${
            source === "inline"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          {t("dashboard.markdownSourceNew")}
        </button>
        <button
          type="button"
          onClick={() => chooseSource("file")}
          className={`flex-1 px-3 py-1.5 border-l border-gray-300 dark:border-gray-600 ${
            source === "file"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          {t("dashboard.markdownSourceFile")}
        </button>
      </div>

      {source === "file" ? (
        <div ref={pickerRef} className="relative">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("dashboard.markdownSelectFile")}
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowList(true);
            }}
            onFocus={() => setShowList(true)}
            placeholder={t("dashboard.markdownSelectFilePlaceholder")}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          {showList && (
            <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-56 overflow-auto">
              {filteredFiles.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-400">{t("dashboard.noFiles")}</div>
              ) : (
                <ul className="py-1">
                  {filteredFiles.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => selectFile(f.id, f.path || f.name)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                          f.id === cfg.fileId
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        <FileText size={12} className="shrink-0 text-gray-400" />
                        <span className="truncate">{f.path || f.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {cfg.fileId && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <FileText size={12} className="shrink-0" />
              <span className="truncate">{cfg.fileName ?? cfg.fileId}</span>
              <button
                type="button"
                onClick={() => onChange({ content })}
                title={t("dashboard.cancel")}
                className="ml-auto shrink-0 text-gray-400 hover:text-red-500"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      ) : !MarkdownEditorComponent ? (
        <div className="flex h-40 items-center justify-center text-sm text-gray-400">
          {t("dashboard.loading")}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("dashboard.content")}
          </label>
          <div
            className="h-64 border border-gray-300 dark:border-gray-700 rounded-md overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <MarkdownEditorComponent
              value={content || "\n"}
              onChange={handleContentChange}
              placeholder={t("dashboard.writeWidgetContent")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
