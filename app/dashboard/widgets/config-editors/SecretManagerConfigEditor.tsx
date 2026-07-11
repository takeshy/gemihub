import { useMemo } from "react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";
import type { SecretManagerConfig } from "../../secret-manager";
import { FolderPicker } from "./FolderPicker";

export function SecretManagerConfigEditor({ config, onChange }: ConfigEditorProps) {
  const { t } = useI18n();
  const cfg = useMemo(() => (config ?? {}) as SecretManagerConfig, [config]);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t("secretManager.folder")}
      </label>
      <FolderPicker
        value={cfg.folder ?? ""}
        onChange={(folder) => onChange({ ...cfg, folder })}
      />
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t("secretManager.folderHint")}
      </p>
    </div>
  );
}
