import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { EnterpriseProvider } from "~/contexts/EnterpriseContext";
import { StaticPluginProvider } from "~/contexts/plugin-context";
import { I18nProvider } from "~/i18n/context";
import { SettingsTemplate, type SettingsTabId } from "./SettingsTemplate";
import { settingsFixture } from "./settings.fixtures";
import { OrganizationWorkspaceBar, organizationWorkspaceFixture } from "./OrganizationWorkspaceBar";
import type { Language } from "~/types/settings";

function SettingsScreen({ initialTab, organization = false, language = "ja" }: { initialTab: SettingsTabId; organization?: boolean; language?: Language }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const selection = organization
    ? { orgId: "acme", projectId: "website", projectName: "Website renewal", role: "admin" as const, allowedModels: [], gcsPrefix: "projects/website", region: "asia-northeast1" }
    : null;
  return (
    <EnterpriseProvider
      selection={selection}
      currentOrgId="acme"
      currentProjectId="website"
      currentUserId="user-1"
      currentUserEmail="owner@example.com"
      hasOrganizations
    >
      <I18nProvider language={language}>
        <StaticPluginProvider>
          {organization && <OrganizationWorkspaceBar workspace={organizationWorkspaceFixture} />}
          <SettingsTemplate
            settings={settingsFixture}
            hasApiKey
            maskedKey="AIza***demo"
            hasHubworkScopes
            rootFolderId="storybook-root"
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onBack={() => undefined}
            onLanguageChange={() => undefined}
            showEnterpriseTab
          />
        </StaticPluginProvider>
      </I18nProvider>
    </EnterpriseProvider>
  );
}

function StoryRoute({ initialTab, organization = false, language = "ja" }: { initialTab: SettingsTabId; organization?: boolean; language?: Language }) {
  const router = useMemo(
    () => createMemoryRouter([
      {
        path: "*",
        element: <SettingsScreen initialTab={initialTab} organization={organization} language={language} />,
        action: async () => ({ success: true }),
      },
    ]),
    [initialTab, organization, language],
  );
  return <RouterProvider router={router} />;
}

const meta = {
  title: "Templates/Settings",
  component: SettingsTemplate,
  parameters: { layout: "fullscreen" },
  render: ({ activeTab }) => <StoryRoute initialTab={activeTab} />,
  args: {
    settings: settingsFixture,
    hasApiKey: true,
    maskedKey: "AIza***demo",
    hasHubworkScopes: true,
    rootFolderId: "storybook-root",
    activeTab: "general",
    onTabChange: () => undefined,
    onBack: () => undefined,
    onLanguageChange: () => undefined,
    showEnterpriseTab: true,
  },
} satisfies Meta<typeof SettingsTemplate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const General: Story = {};
export const Enterprise: Story = { args: { activeTab: "enterprise" } };
export const EnterpriseOrganizationProject: Story = {
  args: { activeTab: "enterprise" },
  render: () => <StoryRoute initialTab="enterprise" organization />,
};
export const GeneralOrganizationProject: Story = {
  args: { activeTab: "general" },
  render: () => <StoryRoute initialTab="general" organization />,
};
export const SyncOrganizationProject: Story = {
  args: { activeTab: "sync" },
  render: () => <StoryRoute initialTab="sync" organization />,
};
export const Sync: Story = { args: { activeTab: "sync" } };
export const Mcp: Story = { args: { activeTab: "mcp" } };
export const Rag: Story = { args: { activeTab: "rag" } };
export const Commands: Story = { args: { activeTab: "commands" } };
export const Shortcuts: Story = { args: { activeTab: "shortcuts" } };
export const Plugins: Story = { args: { activeTab: "plugins" } };
export const Hubwork: Story = { args: { activeTab: "hubwork" } };

export const GeneralEnglish: Story = { render: () => <StoryRoute initialTab="general" language="en" /> };
export const SyncEnglish: Story = { render: () => <StoryRoute initialTab="sync" language="en" /> };
export const McpEnglish: Story = { render: () => <StoryRoute initialTab="mcp" language="en" /> };
export const RagEnglish: Story = { render: () => <StoryRoute initialTab="rag" language="en" /> };
export const CommandsEnglish: Story = { render: () => <StoryRoute initialTab="commands" language="en" /> };
export const ShortcutsEnglish: Story = { render: () => <StoryRoute initialTab="shortcuts" language="en" /> };
export const PluginsEnglish: Story = { render: () => <StoryRoute initialTab="plugins" language="en" /> };
export const GeneralOrganizationProjectEnglish: Story = { render: () => <StoryRoute initialTab="general" organization language="en" /> };
export const EnterpriseOrganizationProjectEnglish: Story = { render: () => <StoryRoute initialTab="enterprise" organization language="en" /> };
export const SyncOrganizationProjectEnglish: Story = { render: () => <StoryRoute initialTab="sync" organization language="en" /> };
