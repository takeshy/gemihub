import { useMemo } from "react";
import { Code, PenLine } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";

type ComposerMode = "raw" | "wysiwyg";

interface TimelineConfig {
  name?: string;
  path?: string;
  latestCount?: number;
  composerMode?: ComposerMode;
  collapseLineLimit?: number;
  collapseCharLimit?: number;
}

function inferName(path?: string): string {
  return path?.split("/").pop()?.replace(/\.md$/i, "") ?? "";
}

export function TimelineConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as TimelineConfig, [config]);
  const update = (patch: Partial<TimelineConfig>) => onChange({ ...cfg, ...patch });
  const name = cfg.name ?? inferName(cfg.path);
  const composerMode: ComposerMode = cfg.composerMode === "wysiwyg" ? "wysiwyg" : "raw";

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.timelineName")}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Timeline"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t("dashboard.timelineStorageHint")}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.timelineLatestCount")}
        </label>
        <input
          type="number"
          min={1}
          max={200}
          value={cfg.latestCount ?? 20}
          onChange={(e) => {
            const value = Number(e.target.value);
            update({ latestCount: Number.isFinite(value) && value > 0 ? value : 20 });
          }}
          className="w-32 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("dashboard.timelineCollapseLines")}
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={cfg.collapseLineLimit ?? 8}
            onChange={(e) => {
              const value = Number(e.target.value);
              update({ collapseLineLimit: Number.isFinite(value) && value > 0 ? value : 8 });
            }}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("dashboard.timelineCollapseChars")}
          </label>
          <input
            type="number"
            min={40}
            max={5000}
            value={cfg.collapseCharLimit ?? 520}
            onChange={(e) => {
              const value = Number(e.target.value);
              update({ collapseCharLimit: Number.isFinite(value) && value > 0 ? value : 520 });
            }}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.timelineComposerMode")}
        </label>
        <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
          {([
            ["raw", t("mainViewer.raw"), <Code key="raw-icon" size={12} />],
            ["wysiwyg", t("mainViewer.wysiwyg"), <PenLine key="wysiwyg-icon" size={12} />],
          ] as const).map(([mode, label, icon]) => (
            <button
              key={mode}
              type="button"
              onClick={() => update({ composerMode: mode })}
              className={`flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors ${
                composerMode === mode
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
