import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { FileListItem } from "~/contexts/EditorContext";
import { useI18n } from "~/i18n/context";
import { ICON } from "~/utils/icon-sizes";

interface QuickOpenDialogProps {
  open: boolean;
  onClose: () => void;
  fileList: FileListItem[];
  onSelectFile: (id: string, name: string, mimeType: string) => void;
  zClass?: string;
}

function guessMimeType(name: string): string {
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "text/yaml";
  return "text/plain";
}

export function QuickOpenDialog({ open, onClose, fileList, onSelectFile, zClass = "z-50" }: QuickOpenDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query) return fileList;
    const lower = query.toLowerCase();
    return fileList.filter(
      (f) => f.name.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower)
    );
  }, [fileList, query]);

  // Reset state when opened/closed
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus input after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep selectedIndex in range
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (item: FileListItem) => {
      onSelectFile(item.id, item.name, guessMimeType(item.name));
      onClose();
    },
    [onSelectFile, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[selectedIndex]) {
            handleSelect(filtered[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, handleSelect, onClose]
  );

  if (!open) return null;

  const modal = (
    <div
      className={`fixed inset-0 flex justify-center ${zClass}`}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Dialog */}
      <div
        className="relative mt-[15vh] flex h-fit w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <Search size={ICON.MD} className="shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400 dark:text-gray-100"
            placeholder={t("quickOpen.placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
        </div>

        {/* File list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
              {t("quickOpen.noResults")}
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? "bg-blue-100 dark:bg-blue-900/40"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="truncate font-medium text-gray-800 dark:text-gray-200">
                  {item.name}
                </span>
                <span className="ml-auto truncate text-xs text-gray-400 dark:text-gray-500">
                  {item.path}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }
  return modal;
}
