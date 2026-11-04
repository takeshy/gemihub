import { addons } from "storybook/manager-api";
import { parseLocale, translate } from "../shared/i18n";
// Story IDs, titles and names stay in Japanese (stable IDs and index metadata);
// the explorer shows them in the language chosen in the toolbar.
function currentLocale(api?: { getGlobals?: () => Record<string, unknown> }) {
  const fromGlobals = parseLocale(api?.getGlobals?.().locale);
  if (fromGlobals) return fromGlobals;
  const globals = new URLSearchParams(location.search).get("globals") || "";
  return parseLocale(/(?:^|;)locale:(\w+)/.exec(globals)?.[1]) || "ja";
}
addons.setConfig({
  sidebar: {
    renderLabel: ({ name }, api) => currentLocale(api as never) === "en" ? translate("en", name) : name,
  },
});
