// Shared @-mention-style markdown file picker used by the markdown widget's
// header (view-mode file switching) and its config editor. Renders a button
// showing the current file path; clicking opens a searchable list of markdown
// files from the editor's file list. The dropdown uses the portal Popover so it
// is never clipped by an overflow-hidden widget cell.

import { useState, useRef, useMemo } from "react";
import { FileText } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { isMarkdownFile } from "~/utils/frontmatter";
import { Popover } from "~/dashboard/data-widget/ViewControls";

export function MarkdownFilePicker({
  currentPath,
  onSelect,
  buttonClassName,
  placeholder,
  fileFilter,
}: {
  /** Path/name to display on the button (falls back to placeholder). */
  currentPath?: string;
  onSelect: (path: string) => void;
  buttonClassName?: string;
  placeholder?: string;
  /** Which files to offer; defaults to markdown files. */
  fileFilter?: (fileName: string) => boolean;
}) {
  const { t } = useI18n();
  const editorCtx = useEditorContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);

  const markdownFiles = useMemo(
    () => editorCtx.fileList.filter((f) => (fileFilter ?? isMarkdownFile)(f.name)),
    [editorCtx.fileList, fileFilter],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? markdownFiles.filter((f) => (f.path || f.name).toLowerCase().includes(q))
      : markdownFiles;
    return base.slice(0, 50);
  }, [markdownFiles, query]);

  const label = currentPath || placeholder || t("dashboard.markdownSelectFile");

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={currentPath || t("dashboard.markdownSelectFile")}
        className={
          buttonClassName ??
          "flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        }
      >
        <FileText size={12} className="shrink-0 text-gray-400" />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <Popover anchorRef={btnRef} onClose={() => setOpen(false)} widthClass="w-80">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("dashboard.markdownSelectFilePlaceholder")}
            className="mb-1 w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="max-h-60 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-2 py-1 text-xs text-gray-400">{t("dashboard.noFiles")}</div>
            ) : (
              <ul className="py-0.5">
                {filtered.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(f.path || f.name);
                        setQuery("");
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        (f.path || f.name) === currentPath
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
        </Popover>
      )}
    </>
  );
}
