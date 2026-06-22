// Config editor for the `card` widget (folder source → card grid).

import { useMemo, useCallback } from "react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../types";
import type { CardWidgetConfig } from "./types";
import { FolderPicker } from "../widgets/config-editors/FolderPicker";
import {
  FilterEditor,
  SortLimitFields,
  CardMappingEditor,
  useFolderFields,
  buildSortOptions,
} from "./config-parts";

export function CardConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as CardWidgetConfig, [config]);
  const folder = cfg.folder ?? "";
  const { fields, loading } = useFolderFields(folder);

  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const fieldTypeMap = useMemo(
    () => new Map(fields.map((f) => [f.name, f.type] as const)),
    [fields],
  );
  const sortOptions = useMemo(() => buildSortOptions(fields, false), [fields]);

  const update = useCallback(
    (patch: Partial<CardWidgetConfig>) => onChange({ ...cfg, ...patch }),
    [cfg, onChange],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.sourceFolder")}
        </label>
        <FolderPicker value={folder} onChange={(f) => update({ folder: f })} />
      </div>

      <CardMappingEditor
        card={cfg.card ?? {}}
        cols={cfg.cols}
        fieldNames={fieldNames}
        onChange={update}
      />

      <FilterEditor
        filters={cfg.filter ?? []}
        fieldNames={fieldNames}
        fieldTypeMap={fieldTypeMap}
        onChange={(filter) => update({ filter })}
      />

      <SortLimitFields
        sort={cfg.sort}
        limit={cfg.limit}
        sortOptions={sortOptions}
        defaultSort="-mtime"
        onChange={update}
      />

      {loading && (
        <p className="text-xs text-gray-400">{t("dashboard.loadingFields")}</p>
      )}
    </div>
  );
}
