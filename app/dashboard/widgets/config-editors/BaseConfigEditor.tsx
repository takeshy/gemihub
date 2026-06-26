// Config editor for the Base widget — select a .base file and view.

import { useState, useEffect, useMemo } from "react";
import { FileText, X, ChevronDown } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";
import { readFileLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { compileBase } from "~/bases/index";
import { collectBaseFileOptions, type BaseFileOption } from "../base-file-options";

interface BaseWidgetConfig {
  base?: string;
  view?: string;
}

export function BaseConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as BaseWidgetConfig, [config]);
  const [baseFiles, setBaseFiles] = useState<BaseFileOption[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [views, setViews] = useState<string[]>([]);

  // Load .base files
  useEffect(() => {
    (async () => {
      const meta = await getCachedRemoteMeta();
      setBaseFiles(meta ? collectBaseFileOptions(meta.files) : []);
    })();
  }, []);

  // Compile the selected .base to get view names
  useEffect(() => {
    if (!cfg.base) {
      setViews([]);
      return;
    }
    (async () => {
      const found = baseFiles.find((f) => f.name === cfg.base);
      if (!found) return;
      try {
        const { getCachedFile } = await import("~/services/indexeddb-cache");
        const cached = await getCachedFile(found.id);
        const content = cached?.content ?? await readFileLocal(found.id);
        const compiled = compileBase(content);
        setViews(compiled.config.views.map((v) => v.name));
      } catch {
        setViews([]);
      }
    })();
  }, [cfg.base, baseFiles]);

  const filteredFiles = useMemo(() => {
    if (!search) return baseFiles;
    return baseFiles.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()));
  }, [baseFiles, search]);

  return (
    <div className="space-y-3">
      {/* .base file selector */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.baseFile")}
        </label>
        {cfg.base ? (
          <div className="flex items-center gap-1.5 text-xs">
            <FileText size={12} className="shrink-0 text-gray-400" />
            <span className="truncate text-gray-600 dark:text-gray-300">{cfg.base}</span>
            <button
              type="button"
              onClick={() => onChange({ ...cfg, base: undefined, view: undefined })}
              className="text-gray-400 hover:text-red-500"
              title="Remove"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPicker(!showPicker)}
              className="flex w-full items-center justify-between rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500"
            >
              <span className="text-gray-400">{t("dashboard.baseSelectPlaceholder")}</span>
              <ChevronDown size={14} />
            </button>
            {showPicker && (
              <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full border-b border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
                  autoFocus
                />
                {filteredFiles.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-gray-400">
                    {t("dashboard.noFiles")}
                  </div>
                ) : (
                  filteredFiles.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        onChange({ ...cfg, base: f.name, view: undefined });
                        setShowPicker(false);
                        setSearch("");
                      }}
                      className="block w-full truncate px-2 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      {f.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* View selector */}
      {cfg.base && views.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("dashboard.baseView")}
          </label>
          <select
            value={cfg.view ?? ""}
            onChange={(e) => onChange({ ...cfg, view: e.target.value || undefined })}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <option value="">Auto (first view)</option>
            {views.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      )}

      {cfg.base && views.length === 0 && (
        <div className="text-xs text-gray-400">{t("dashboard.baseNoViews")}</div>
      )}
    </div>
  );
}
