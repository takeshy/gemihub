import {
  ArrowLeft,
  Building2,
  Database,
  Globe,
  Keyboard,
  Puzzle,
  RefreshCw,
  Server,
  Settings as SettingsIcon,
  Terminal,
} from "lucide-react";
import { CommandsTab } from "~/components/settings/CommandsTab";
import { EnterpriseTab } from "~/components/settings/EnterpriseTab";
import { GeneralTab } from "~/components/settings/GeneralTab";
import { HubworkTab } from "~/components/settings/HubworkTab";
import { McpTab } from "~/components/settings/McpTab";
import { PluginsTab } from "~/components/settings/PluginsTab";
import { RagTab } from "~/components/settings/RagTab";
import { ShortcutsTab } from "~/components/settings/ShortcutsTab";
import { SyncTab } from "~/components/settings/SyncTab";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useI18n } from "~/i18n/context";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import type { TranslationStrings } from "~/i18n/translations";
import type { Language, UserSettings } from "~/types/settings";

export type SettingsTabId =
  | "general"
  | "enterprise"
  | "sync"
  | "mcp"
  | "rag"
  | "commands"
  | "shortcuts"
  | "plugins"
  | "hubwork";

const TABS: {
  id: SettingsTabId;
  labelKey: keyof TranslationStrings;
  icon: typeof SettingsIcon;
  desktopOnly?: boolean;
}[] = [
  { id: "general", labelKey: "settings.tab.general", icon: SettingsIcon },
  { id: "enterprise", labelKey: "settings.tab.enterprise", icon: Building2 },
  { id: "sync", labelKey: "settings.tab.sync", icon: RefreshCw },
  { id: "mcp", labelKey: "settings.tab.mcp", icon: Server },
  { id: "rag", labelKey: "settings.tab.rag", icon: Database },
  { id: "commands", labelKey: "settings.tab.commands", icon: Terminal },
  { id: "shortcuts", labelKey: "settings.tab.shortcuts", icon: Keyboard, desktopOnly: true },
  { id: "plugins", labelKey: "settings.tab.plugins", icon: Puzzle },
  { id: "hubwork", labelKey: "settings.tab.hubwork", icon: Globe },
];

export function isSettingsTabId(value: string | null): value is SettingsTabId {
  return value !== null && TABS.some((tab) => tab.id === value);
}

export interface SettingsTemplateProps {
  settings: UserSettings;
  hasApiKey: boolean;
  maskedKey: string | null;
  hasHubworkScopes: boolean;
  rootFolderId: string;
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  onBack: () => void;
  onLanguageChange: (lang: Language) => void;
  hubworkCallback?: boolean;
  showEnterpriseTab: boolean;
  enterpriseError?: string | null;
}

/**
 * Presentational settings screen shared by the authenticated route and
 * Storybook. All server/session concerns stay outside this template.
 */
export function SettingsTemplate({
  settings,
  hasApiKey,
  maskedKey,
  hasHubworkScopes,
  rootFolderId,
  activeTab,
  onTabChange,
  onBack,
  onLanguageChange,
  hubworkCallback = false,
  showEnterpriseTab,
  enterpriseError = null,
}: SettingsTemplateProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const organizationSelected = useEnterpriseSelection() !== null;
  const showSelectedEnterpriseTab = showEnterpriseTab && organizationSelected;
  // The Stripe billing portal (i.e. the only cancellation path) lives in the
  // Hubwork tab, so a subscriber keeps the tab even while an organization is
  // selected. Plain members of someone else's org have no plan and no tab.
  const showHubworkTab = !!settings.hubwork?.plan || !organizationSelected;
  const orgFilteredTabs = TABS.filter((tab) => {
    if (tab.id === "enterprise") return showSelectedEnterpriseTab;
    if (tab.id === "hubwork") return showHubworkTab;
    if (tab.id === "rag") return settings.ragFeatureEnabled ?? false;
    return true;
  });
  const visibleTabs = isMobile
    ? orgFilteredTabs.filter((tab) => !tab.desktopOnly)
    : orgFilteredTabs;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("settings.title")}</h1>
        </div>
      </header>

      <div className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-5xl px-4">
          <nav className="scrollbar-hide flex gap-1 overflow-x-auto" aria-label="Settings tabs">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:text-sm ${
                    isActive
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  <Icon size={16} />
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-4 sm:py-8">
        {activeTab === "general" && (
          <GeneralTab
            settings={settings}
            hasApiKey={hasApiKey}
            maskedKey={maskedKey}
            onLanguageChange={onLanguageChange}
            hideGeminiSettings={organizationSelected}
          />
        )}
        {activeTab === "enterprise" && (
          <>
            {enterpriseError && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">{t("settings.enterprise.lookupFailed")}</p>
                <p className="mt-1 break-all font-mono text-xs">{enterpriseError}</p>
              </div>
            )}
            {showSelectedEnterpriseTab && <EnterpriseTab />}
          </>
        )}
        {activeTab === "sync" && <SyncTab settings={settings} />}
        {activeTab === "mcp" && <McpTab settings={settings} />}
        {activeTab === "rag" && (settings.ragFeatureEnabled ?? false) && <RagTab settings={settings} />}
        {activeTab === "commands" && <CommandsTab settings={settings} />}
        {activeTab === "plugins" && <PluginsTab settings={settings} />}
        {activeTab === "shortcuts" && <ShortcutsTab settings={settings} />}
        {activeTab === "hubwork" && showHubworkTab && (
          <HubworkTab
            settings={settings}
            hasHubworkScopes={hasHubworkScopes}
            rootFolderId={rootFolderId}
            isCallback={hubworkCallback}
          />
        )}
      </main>
    </div>
  );
}
