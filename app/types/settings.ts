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
  id?: string;
  name: string;
  url: string;
  headers?: Record<string, string>;
  tools?: McpToolInfo[];
  oauth?: OAuthConfig;
  oauthTokens?: OAuthTokens;
}

export function sanitizeMcpIdentifier(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function deriveMcpServerId(
  server: Pick<McpServerConfig, "id" | "name" | "url">,
  fallbackIndex = 0
): string {
  const preferred = sanitizeMcpIdentifier(server.id || "");
  if (preferred) return preferred;

  const base = sanitizeMcpIdentifier(server.name || "server") || "server";
  const hash = hashString(`${server.url || ""}|${server.name || ""}|${fallbackIndex}`);
  return `mcp_${base}_${hash}`;
}

export function normalizeMcpServers(servers: McpServerConfig[]): McpServerConfig[] {
  const used = new Set<string>();
  return servers.map((server, index) => {
    const baseId = deriveMcpServerId(server, index);
    let id = baseId;
    let suffix = 2;
    while (used.has(id)) {
      id = `${baseId}_${suffix++}`;
    }
    used.add(id);
    if (server.id === id) return server;
    return { ...server, id };
  });
}

export function normalizeSelectedMcpServerIds(
  selected: string[] | null | undefined,
  servers: McpServerConfig[]
): string[] {
  if (!selected || selected.length === 0) return [];
  const byId = new Map<string, string>();
  const byNameCounts = new Map<string, number>();
  const byNameUniqueId = new Map<string, string>();

  for (const server of normalizeMcpServers(servers)) {
    if (!server.id) continue;
    byId.set(server.id, server.id);
    byNameCounts.set(server.name, (byNameCounts.get(server.name) || 0) + 1);
    byNameUniqueId.set(server.name, server.id);
  }

  const resolved: string[] = [];
  for (const value of selected) {
    const uniqueNameId =
      byNameCounts.get(value) === 1 ? byNameUniqueId.get(value) : undefined;
    const id = byId.get(value) || uniqueNameId;
    if (id && !resolved.includes(id)) {
      resolved.push(id);
    }
  }
  return resolved;
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

export interface EncryptionParams {
  publicKey: string;
  encryptedPrivateKey: string;
  salt: string;
}

export function getEncryptionParams(
  settings: UserSettings,
  type: "chat" | "workflow"
): EncryptionParams | undefined {
  const enc = settings.encryption;
  const enabled = type === "chat" ? enc.encryptChatHistory : enc.encryptWorkflowHistory;
  if (!enc.enabled || !enabled || !enc.publicKey || !enc.encryptedPrivateKey || !enc.salt) return undefined;
  return {
    publicKey: enc.publicKey,
    encryptedPrivateKey: enc.encryptedPrivateKey,
    salt: enc.salt,
  };
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
  excludePatterns: ["^temporaries/", "^workflows/"],
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
  // MCP server IDs (legacy data may still contain names; normalized on read).
  enabledMcpServers?: string[] | null;
}

// Shortcut key actions
export type ShortcutAction = "executeWorkflow";

export const SHORTCUT_ACTIONS: { value: ShortcutAction; labelKey: string }[] = [
  { value: "executeWorkflow", labelKey: "settings.shortcuts.actionExecuteWorkflow" },
];

// Shortcut key binding
export interface ShortcutKeyBinding {
  id: string;
  action: ShortcutAction;
  key: string;        // e.g. "F5", "e", "r"
  ctrlOrMeta: boolean; // Ctrl (Win/Linux) / Cmd (Mac)
  shift: boolean;
  alt: boolean;
  targetFileId?: string;   // For executeWorkflow: which workflow to run
  targetFileName?: string; // For executeWorkflow: display name
}

// Built-in shortcuts that cannot be overridden
export const BUILTIN_SHORTCUTS: { key: string; ctrlOrMeta: boolean; shift: boolean; alt: boolean }[] = [
  { key: "f", ctrlOrMeta: true, shift: true, alt: false },  // Search
  { key: "p", ctrlOrMeta: true, shift: false, alt: false },  // Quick Open
];

// Function keys that are allowed without modifiers
const FUNCTION_KEY_RE = /^F([1-9]|1[0-2])$/;
export function isFunctionKey(key: string): boolean {
  return FUNCTION_KEY_RE.test(key);
}

export function isBuiltinShortcut(binding: { key: string; ctrlOrMeta: boolean; shift: boolean; alt: boolean }): boolean {
  return BUILTIN_SHORTCUTS.some(
    (b) =>
      b.key.toLowerCase() === binding.key.toLowerCase() &&
      b.ctrlOrMeta === binding.ctrlOrMeta &&
      b.shift === binding.shift &&
      b.alt === binding.alt
  );
}

export function isValidShortcutKey(binding: { key: string; ctrlOrMeta: boolean; shift: boolean; alt: boolean }): boolean {
  if (!binding.key) return true; // Not yet assigned
  // Function keys are always allowed
  if (isFunctionKey(binding.key)) return true;
  // Shift alone is not enough — require Ctrl/Cmd or Alt
  return binding.ctrlOrMeta || binding.alt;
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
  syncConflictFolder: string;
  encryptedApiKey: string;
  apiKeySalt: string;
  shortcutKeys: ShortcutKeyBinding[];
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
  syncConflictFolder: "sync_conflicts",
  encryptedApiKey: "",
  apiKeySalt: "",
  shortcutKeys: [],
};
