import { Puzzle } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { WidgetContext } from "../types";

/**
 * Placeholder for unknown/unregistered widget types.
 * The widget's data (type, config, unknown keys) is preserved
 * in the .dashboard YAML — only the rendering falls back.
 */
export default function UnknownWidget({
  type,
}: {
  type: string;
  config?: unknown;
  ctx?: WidgetContext;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-400">
      <Puzzle size={24} className="text-gray-300 dark:text-gray-600" />
      <span>{t("dashboard.unsupportedWidget")}: {type}</span>
    </div>
  );
}
