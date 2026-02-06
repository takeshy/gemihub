import { useEffect, useRef } from "react";
import { Terminal, FileText, Hash } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { AutocompleteItem, AutocompleteMode } from "~/hooks/useAutocomplete";

interface AutocompletePopupProps {
  items: AutocompleteItem[];
  selectedIndex: number;
  mode: AutocompleteMode;
  onSelect: (item: AutocompleteItem) => void;
}

export function AutocompletePopup({
  items,
  selectedIndex,
  mode,
  onSelect,
}: AutocompletePopupProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement | undefined;
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
    >
      {mode && (
        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
          {mode === "command" ? "Commands" : "Mention"}
        </div>
      )}
      {items.map((item, idx) => (
        <button
          key={`${item.type}-${item.label}`}
          onMouseDown={(e) => {
            e.preventDefault(); // don't blur textarea
            onSelect(item);
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
            idx === selectedIndex
              ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
          }`}
        >
          <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">
            {item.type === "command" && <Terminal size={ICON.MD} />}
            {item.type === "file" && <FileText size={ICON.MD} />}
            {item.type === "variable" && <Hash size={ICON.MD} />}
          </span>
          <span className="font-medium truncate">{item.label}</span>
          <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[50%]">
            {item.description}
          </span>
        </button>
      ))}
    </div>
  );
}
