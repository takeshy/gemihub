import { useMemo } from "react";
import { useI18n } from "~/i18n/context";
import type { ConfigEditorProps } from "../../types";
import { normalizeSecretFolder, type SecretManagerConfig } from "../../secret-manager";
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
        required
        placeholder="Secrets"
        value={cfg.folder ?? "Secrets"}
        onChange={(folder) => onChange({ ...cfg, folder })}
      />
      {!normalizeSecretFolder(cfg.folder ?? "Secrets") && (
        <p role="alert" className="text-xs text-red-500">{t("secretManager.folderRequired")}</p>
      )}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t("secretManager.folderHint")}
      </p>
    </div>
  );
}
