import { useState, useRef, useEffect } from "react";
import { BookOpen, X, Plus } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { OkfBundle } from "~/services/okf-loader";

interface OkfSelectorProps {
  bundles: OkfBundle[];
  activeBundleIds: string[];
  onToggleBundle: (bundleId: string) => void;
  /** Re-discover bundles (called when the dropdown opens). */
  onRefreshBundles?: () => void;
  disabled?: boolean;
}

/**
 * Inline OKF bundle selector: 📖 [chip ×] [chip ×] [+ dropdown]
 * Same interaction pattern as SkillSelector.
 */
export function OkfSelector({
  bundles,
  activeBundleIds,
  onToggleBundle,
  onRefreshBundles,
  disabled,
}: OkfSelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (bundles.length === 0) return null;

  const activeBundles = bundles.filter((b) => activeBundleIds.includes(b.id));

  return (
    <div className="flex items-center gap-1 px-3 py-1 flex-wrap">
      <BookOpen size={14} className="flex-shrink-0 text-gray-400 dark:text-gray-500" />
      {activeBundles.map((bundle) => (
        <span
          key={bundle.id}
          className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2 py-0.5 text-[11px] text-white whitespace-nowrap"
          title={bundle.id || "(root)"}
        >
          <span>{bundle.name}</span>
          <button
            onClick={() => onToggleBundle(bundle.id)}
            disabled={disabled}
            className="inline-flex items-center justify-center p-0 ml-0.5 opacity-70 hover:opacity-100 bg-transparent border-none text-white cursor-pointer shadow-none"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <div className="relative inline-flex" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => {
            if (!open) onRefreshBundles?.();
            setOpen(!open);
          }}
          disabled={disabled}
          className="inline-flex items-center justify-center w-5 h-5 p-0 rounded-full border border-dashed border-gray-400 bg-transparent text-gray-400 cursor-pointer hover:border-gray-600 hover:text-gray-600 dark:border-gray-500 dark:text-gray-500 dark:hover:border-gray-300 dark:hover:text-gray-300 disabled:opacity-50 shadow-none"
          title={t("okf.selector.title")}
        >
          <Plus size={12} />
        </button>
        {open && (
          <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[200px] max-h-[200px] overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {bundles.map((bundle) => {
              const isActive = activeBundleIds.includes(bundle.id);
              return (
                <label
                  key={bundle.id}
                  className="flex items-start gap-1.5 rounded px-1.5 py-1 cursor-pointer text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={() => onToggleBundle(bundle.id)}
                    disabled={disabled}
                    className="mt-0.5 flex-shrink-0"
                  />
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{bundle.name}</span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {bundle.id || "(root)"}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
