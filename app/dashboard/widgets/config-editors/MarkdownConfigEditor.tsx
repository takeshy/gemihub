import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";
import { MarkdownFilePicker } from "./MarkdownFilePicker";
import { writeFileLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";

interface MarkdownConfig {
  path?: string;
  showHeader?: boolean;
}

type SourceMode = "create" | "import";

/**
 * Markdown config editor — create a new markdown file or reference an existing
 * one. Content editing happens in the widget itself via MarkdownFileEditor.
 */
export function MarkdownConfigEditor({ config, onChange, setDoneAction }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as MarkdownConfig, [config]);
  const [newName, setNewName] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>(cfg.path ? "import" : "create");

  const buildNewFile = useCallback(async () => {
      const meta = await getCachedRemoteMeta();
      const names = new Set(Object.values(meta?.files ?? {}).map((f) => f.name));
      const stem = (newName.trim() || "New Note").replace(/\.md$/i, "");
      let fileName = `${stem}.md`;
      let i = 2;
      while (names.has(fileName)) {
        fileName = `${stem} ${i}.md`;
        i += 1;
      }
      await writeFileLocal(fileName, `# ${stem}\n`);
      return { ...cfg, path: fileName };
  }, [cfg, newName]);

  useEffect(() => {
    if (!setDoneAction) return;
    if (cfg.path || sourceMode !== "create") {
      setDoneAction(null);
      return;
    }
    setDoneAction(buildNewFile);
    return () => setDoneAction(null);
  }, [buildNewFile, cfg.path, setDoneAction, sourceMode]);

  const sourceSwitch = (
    <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
      {([
        ["create", t("dashboard.baseCreate")],
        ["import", t("contextMenu.import")],
      ] as const).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => setSourceMode(mode)}
          className={`rounded px-2.5 py-1 font-medium transition-colors ${
            sourceMode === mode
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (cfg.path) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <FileText size={12} className="shrink-0" />
          <span className="truncate">{cfg.path}</span>
          <button
            type="button"
            onClick={() => onChange({ ...cfg, path: "" })}
            title={t("dashboard.cancel")}
            className="ml-auto shrink-0 text-gray-400 hover:text-red-500"
          >
            <X size={12} />
          </button>
        </div>
        <MarkdownFilePicker
          currentPath={cfg.path}
          onSelect={(path) => onChange({ ...cfg, path })}
          buttonClassName="flex w-full items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        />
        <HeaderToggle
          checked={cfg.showHeader !== false}
          onChange={(showHeader) => onChange({ ...cfg, showHeader })}
          label={t("dashboard.markdownShowHeader")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sourceSwitch}
      <HeaderToggle
        checked={cfg.showHeader !== false}
        onChange={(showHeader) => onChange({ ...cfg, showHeader })}
        label={t("dashboard.markdownShowHeader")}
      />

      {sourceMode === "create" ? (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("dashboard.markdownCreateNew")}
        </label>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New Note"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t("dashboard.markdownCreateOnDone")}
        </p>
      </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
            {t("dashboard.markdownImportExisting")}
          </label>
          <MarkdownFilePicker
            currentPath={undefined}
            onSelect={(path) => onChange({ ...cfg, path })}
            buttonClassName="flex w-full items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          />
        </div>
      )}
    </div>
  );
}

function HeaderToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
    </label>
  );
}
