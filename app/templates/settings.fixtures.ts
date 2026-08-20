import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";

export const settingsFixture: UserSettings = {
  ...DEFAULT_USER_SETTINGS,
  language: "ja",
  theme: "light",
  workflowEnabled: true,
  dashboardEnabled: true,
  ragFeatureEnabled: true,
  webpageBuilderEnabled: true,
  ragEnabled: true,
  ragTopK: 8,
  ragSettings: {
    gemihub: {
      storeId: "sample-store",
      storeIds: ["sample-store"],
      storeName: "GemiHub documents",
      isExternal: false,
      targetFolders: ["Knowledge"],
      excludePatterns: ["Archive/.*"],
      files: {},
      lastFullSync: Date.now() - 3_600_000,
    },
  },
  selectedRagSetting: "gemihub",
  mcpServers: [
    {
      id: "github",
      name: "GitHub",
      url: "https://mcp.example.test/github",
      tools: [
        { name: "search_repositories", description: "Search repositories" },
        { name: "get_pull_request", description: "Read a pull request" },
      ],
    },
  ],
  slashCommands: [
    {
      id: "summarize",
      name: "summarize",
      description: "選択範囲を短く要約します",
      promptTemplate: "次の内容を要約してください:\n\n{selection}",
      model: null,
      searchSetting: null,
      driveToolMode: "none",
      enabledMcpServers: null,
    },
  ],
  shortcutKeys: [
    {
      id: "weekly-report",
      action: "executeWorkflow",
      targetFileId: "weekly",
      targetFileName: "Workflows/weekly-report.yaml",
      key: "r",
      ctrlOrMeta: true,
      shift: true,
      alt: false,
    },
  ],
  plugins: [],
  agentPlugins: [
    {
      name: "research-tools",
      version: "1.2.0",
      repo: "example/research-tools",
      sourceType: "branch",
      sourceRef: "main",
      commitSha: "0123456789abcdef",
      enabled: true,
    },
  ],
  hubwork: {
    plan: "business",
    currency: "jpy",
    billingStatus: "active",
    accountStatus: "enabled",
    accountId: "acct_storybook",
    accountSlug: "acme-design",
    defaultDomain: "acme-design.gemihub.net",
    customDomain: "docs.example.com",
    domainStatus: "active",
    skillVersion: "1.0.0",
    spreadsheets: [{ id: "storybook-sheet", label: "Content calendar" }],
    schedules: [
      {
        workflowPath: "Workflows/weekly-report.yaml",
        cron: "0 9 * * 1",
        enabled: true,
        timezone: "Asia/Tokyo",
      },
    ],
  },
};
