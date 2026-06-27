import WebEmbed from "~/components/shared/WebEmbed";
import { useI18n } from "~/i18n/context";
import type { WidgetContext } from "../types";

export default function WebWidget({
  config,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const { t } = useI18n();
  const cfg = (config ?? {}) as Record<string, unknown>;
  const url = cfg.url;
  const href = typeof url === "string" ? url : "";
  const showHeader = cfg.showHeader !== false;

  if (!href) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.noUrl")}
      </div>
    );
  }

  return <WebEmbed url={href} interactive showHeader={showHeader} />;
}
