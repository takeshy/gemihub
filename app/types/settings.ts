// Settings type definitions - ported from obsidian-gemini-helper

// OAuth configuration for MCP servers
export interface OAuthConfig {
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientSecret?: string;
}

// OAuth tokens for MCP servers
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
}

// MCP (Model Context Protocol) server configuration
export interface McpServerConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
  tools?: McpToolInfo[];
  oauth?: OAuthConfig;
  oauthTokens?: OAuthTokens;
}

// MCP tool information (from server)
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  _meta?: {
    ui?: {
      resourceUri: string;
    };
  };
}

// MCP Apps types
export interface McpAppContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri: string;
    mimeType?: string;
    text?: string;
  };
}

export interface McpAppResult {
  content: McpAppContent[];
  isError?: boolean;
  _meta?: {
    ui?: {
      resourceUri: string;
    };
  };
}

export interface McpAppUiResource {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

// API Plan
export type ApiPlan = "paid" | "free";

// Drive Tool Mode
export type DriveToolMode = "all" | "noSearch" | "none";

export interface DriveToolModeConstraint {
  forcedMode: DriveToolMode | null;
  defaultMode: DriveToolMode;
  locked: boolean;
  reasonKey?: string;
}

export function getDriveToolModeConstraint(
  model: string,
  ragSetting: string | null
): DriveToolModeConstraint {
  const m = model.toLowerCase();
  if (m.includes("gemma")) {
    return { forcedMode: "none", defaultMode: "none", locked: true, reasonKey: "chat.toolModeLockGemma" };
  }
  if (ragSetting === "__websearch__") {
    return { forcedMode: "none", defaultMode: "none", locked: true, reasonKey: "chat.toolModeLockWebSearch" };
  }
  if (m.includes("flash-lite") && ragSetting && ragSetting !== "__websearch__") {
    return { forcedMode: "none", defaultMode: "none", locked: true, reasonKey: "chat.toolModeLockFlashLiteRag" };
  }
  if (ragSetting && ragSetting !== "__websearch__") {
    return { forcedMode: null, defaultMode: "noSearch", locked: false };
  }
  return { forcedMode: null, defaultMode: "all", locked: false };
}

// Language
export type Language = "en" | "ja";

export const SUPPORTED_LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];

// Theme
export type Theme = "light" | "dark" | "system";

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Font Size
export type FontSize = 14 | 16 | 18 | 20;

export const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: 14, label: "Small (14px)" },
  { value: 16, label: "Medium (16px)" },
  { value: 18, label: "Large (18px)" },
  { value: 20, label: "Extra Large (20px)" },
];

// Model types
export type ModelType =
  | "gemini-2.5-flash"
  | "gemini-2.5-pro"
  | "gemini-3-flash-preview"
  | "gemini-3-pro-preview"
  | "gemini-2.5-flash-lite"
  | "gemini-2.5-flash-image"
  | "gemini-3-pro-image-preview"
  | "gemma-3-27b-it"
  | "gemma-3-12b-it"
  | "gemma-3-4b-it"
  | "gemma-3-1b-it";

export interface ModelInfo {
  name: ModelType;
  displayName: string;
  description: string;
  isImageModel?: boolean;
}

export const PAID_MODELS: ModelInfo[] = [
  {
    name: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash Preview",
    description: "Latest fast model with 1M context, best cost-performance (recommended)",
  },
  {
    name: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro Preview",
    description: "Latest flagship model with 1M context, best performance",
  },
  {
    name: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    description: "Fast model with 1M context",
  },
  {
    name: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    description: "Pro model with 1M context",
  },
  {
    name: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash Lite",
    description: "Lightweight flash model",
  },
  {
    name: "gemini-2.5-flash-image",
    displayName: "Gemini 2.5 Flash (Image)",
    description: "Fast image generation, max 1024px",
    isImageModel: true,
  },
  {
    name: "gemini-3-pro-image-preview",
    displayName: "Gemini 3 Pro (Image)",
    description: "Pro quality image generation, up to 4K",
    isImageModel: true,
  },
];

export const FREE_MODELS: ModelInfo[] = [
  {
    name: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    description: "Free tier fast model",
  },
  {
    name: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash Lite",
    description: "Free tier lightweight model",
  },
  {
    name: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash Preview",
    description: "Free tier preview model",
  },
  {
    name: "gemma-3-27b-it",
    displayName: "Gemma 3 27B (No tools)",
    description: "Free tier Gemma model (no function calling)",
  },
  {
    name: "gemma-3-12b-it",
    displayName: "Gemma 3 12B (No tools)",
    description: "Free tier Gemma model (no function calling)",
  },
  {
    name: "gemma-3-4b-it",
    displayName: "Gemma 3 4B (No tools)",
    description: "Free tier Gemma model (no function calling)",
  },
  {
    name: "gemma-3-1b-it",
    displayName: "Gemma 3 1B (No tools)",
    description: "Free tier Gemma model (no function calling)",
  },
];

function mergeModelLists(lists: ModelInfo[][]): ModelInfo[] {
  const merged: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const model of list) {
      if (!seen.has(model.name)) {
        seen.add(model.name);
        merged.push(model);
      }
    }
  }
  return merged;
}

export const AVAILABLE_MODELS: ModelInfo[] = mergeModelLists([PAID_MODELS, FREE_MODELS]);

export function getAvailableModels(plan: ApiPlan): ModelInfo[] {
  return plan === "free" ? FREE_MODELS : PAID_MODELS;
}

export function isModelAllowedForPlan(plan: ApiPlan, modelName: ModelType): boolean {
  return getAvailableModels(plan).some((model) => model.name === modelName);
}

export function isImageGenerationModel(modelName: ModelType): boolean {
  const model = AVAILABLE_MODELS.find((m) => m.name === modelName);
  return model?.isImageModel ?? false;
}

// Default models by plan
export const DEFAULT_MODEL_FREE: ModelType = "gemini-2.5-flash";
export const DEFAULT_MODEL_PAID: ModelType = "gemini-3-pro-preview";

export function getDefaultModelForPlan(plan: ApiPlan): ModelType {
  return plan === "paid" ? DEFAULT_MODEL_PAID : DEFAULT_MODEL_FREE;
}

// Encryption settings
export interface EncryptionSettings {
  enabled: boolean;
  encryptChatHistory: boolean;
  encryptWorkflowHistory: boolean;
  publicKey: string;
  encryptedPrivateKey: string;
  salt: string;
}

export const DEFAULT_ENCRYPTION_SETTINGS: EncryptionSettings = {
  enabled: false,
  encryptChatHistory: false,
  encryptWorkflowHistory: false,
  publicKey: "",
  encryptedPrivateKey: "",
  salt: "",
};

// Edit history settings
export interface EditHistorySettings {
  retention: {
    maxAgeInDays: number;
    maxEntriesPerFile: number;
  };
  diff: {
    contextLines: number;
  };
}

export const DEFAULT_EDIT_HISTORY_SETTINGS: EditHistorySettings = {
  retention: {
    maxAgeInDays: 30,
    maxEntriesPerFile: 100,
  },
  diff: {
    contextLines: 3,
  },
};

// RAG setting
export interface RagSetting {
  storeId: string | null;
  storeIds: string[];
  storeName: string | null;
  isExternal: boolean;
  targetFolders: string[];
  excludePatterns: string[];
  files: Record<string, RagFileInfo>;
  lastFullSync: number | null;
}

export interface RagFileInfo {
  checksum: string;
  uploadedAt: number;
  fileId: string | null;
  status: "registered" | "pending";
}

export const DEFAULT_RAG_STORE_KEY = "gemihub";

export const DEFAULT_RAG_SETTING: RagSetting = {
  storeId: null,
  storeIds: [],
  storeName: null,
  isExternal: false,
  targetFolders: [],
  excludePatterns: [],
  files: {},
  lastFullSync: null,
};

// Tool definition for Function Calling
export interface ToolPropertyDefinition {
  type: string;
  description: string;
  enum?: string[];
  properties?: Record<string, ToolPropertyDefinition>;
  required?: string[];
  items?:
    | ToolPropertyDefinition
    | {
        type: string;
        properties?: Record<string, ToolPropertyDefinition>;
        required?: string[];
      };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolPropertyDefinition>;
    required?: string[];
  };
}

// Plugin configuration (stored in settings.json)
export interface PluginConfig {
  id: string;
  repo: string; // "owner/repo"
  version: string;
  enabled: boolean;
  source?: "local" | "github";
}

// Slash command for chat
export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  model?: ModelType | null;
  searchSetting?: string | null;
  driveToolMode?: DriveToolMode | null;
  enabledMcpServers?: string[] | null;
}

// User settings (stored in Drive as settings.json)
export interface UserSettings {
  apiPlan: ApiPlan;
  selectedModel: ModelType | null;
  mcpServers: McpServerConfig[];
  encryption: EncryptionSettings;
  editHistory: EditHistorySettings;
  ragEnabled: boolean;
  ragTopK: number;
  ragSettings: Record<string, RagSetting>;
  selectedRagSetting: string | null;
  systemPrompt: string;
  maxFunctionCalls: number;
  functionCallWarningThreshold: number;
  rootFolderName: string;
  language: Language;
  fontSize: FontSize;
  theme: Theme;
  slashCommands: SlashCommand[];
  plugins: PluginConfig[];
  ragRegistrationOnPush: boolean;
  syncExcludePatterns: string[];
  syncConflictFolder: string;
  encryptedApiKey: string;
  apiKeySalt: string;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  apiPlan: "paid",
  selectedModel: null,
  mcpServers: [],
  encryption: DEFAULT_ENCRYPTION_SETTINGS,
  editHistory: DEFAULT_EDIT_HISTORY_SETTINGS,
  ragEnabled: false,
  ragTopK: 5,
  ragSettings: {},
  selectedRagSetting: null,
  systemPrompt: "",
  maxFunctionCalls: 20,
  functionCallWarningThreshold: 5,
  rootFolderName: "GeminiHub",
  language: "en",
  fontSize: 16,
  theme: "system",
  slashCommands: [],
  plugins: [],
  ragRegistrationOnPush: false,
  syncExcludePatterns: [],
  syncConflictFolder: "sync_conflicts",
  encryptedApiKey: "",
  apiKeySalt: "",
};
