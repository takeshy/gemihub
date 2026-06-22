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
  const url = (config as Record<string, unknown>)?.url;
  const href = typeof url === "string" ? url : "";

  if (!href) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.noUrl")}
      </div>
    );
  }

  return <WebEmbed url={href} interactive />;
}
