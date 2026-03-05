// Plugin system type definitions

import type React from "react";
import type { PluginConfig } from "~/types/settings";

/** External asset declared in manifest.json */
export interface PluginAsset {
  /** Filename used to reference this asset via api.assets.fetch(name) */
  name: string;
  /** Upstream URL the server downloads from */
  url: string;
}

/** manifest.json schema */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  /** Optional list of external assets the plugin needs (served via api.assets.fetch) */
  assets?: PluginAsset[];
}

/** View registered by a plugin */
export interface PluginView {
  id: string;
  pluginId: string;
  name: string;
  icon?: string;
  location: "sidebar" | "main";
  extensions?: string[];
  component: React.ComponentType<{ api: PluginAPI; language?: string; fileId?: string; fileName?: string }>;
}

/** Slash command registered by a plugin */
export interface PluginSlashCommand {
  pluginId: string;
  name: string;
  description: string;
  execute: (args: string) => Promise<string>;
}

/** Settings tab registered by a plugin */
export interface PluginSettingsTab {
  pluginId: string;
  component: React.ComponentType<{ api: PluginAPI; language?: string; onClose?: () => void }>;
}

/** API exposed to plugins */
export interface PluginAPI {
  // Current language setting (e.g. "en", "ja")
  language: string;

  // UI registration
  registerView(view: {
    id: string;
    name: string;
    icon?: string;
    location: "sidebar" | "main";
    extensions?: string[];
    component: React.ComponentType<{ api: PluginAPI; language?: string; fileId?: string; fileName?: string }>;
  }): void;
  registerSlashCommand(cmd: {
    name: string;
    description: string;
    execute: (args: string) => Promise<string>;
  }): void;
  registerSettingsTab(tab: {
    component: React.ComponentType<{ api: PluginAPI; language?: string; onClose?: () => void }>;
  }): void;

  // Gemini API (via host /api/chat)
  gemini: {
    chat(
      messages: Array<{ role: string; content: string }>,
      options?: { model?: string; systemPrompt?: string }
    ): Promise<string>;
  };

  // Drive operations (via host /api/drive/*)
  drive: {
    readFile(fileId: string): Promise<string>;
    searchFiles(
      query: string
    ): Promise<Array<{ id: string; name: string; mimeType: string }>>;
    listFiles(
      folderId?: string
    ): Promise<Array<{ id: string; name: string; mimeType: string }>>;
    createFile(
      name: string,
      content: string | ArrayBuffer
    ): Promise<{ id: string; name: string }>;
    updateFile(fileId: string, content: string | ArrayBuffer): Promise<void>;
    rebuildTree(): Promise<void>;
  };

  // Plugin-scoped storage (data.json on Drive)
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    getAll(): Promise<Record<string, unknown>>;
  };

  // External asset fetching (declared in manifest.json assets[])
  assets: {
    /**
     * Fetch a declared asset by name.
     * The server downloads from the upstream URL on first call and caches it.
     * Returns the raw bytes as an ArrayBuffer.
     */
    fetch(name: string): Promise<ArrayBuffer>;
  };

  // Host React instances (shared)
  React: typeof React;
  ReactDOM: typeof import("react-dom");
}

/** Internal representation of a loaded plugin */
export interface PluginInstance {
  id: string;
  manifest: PluginManifest;
  config: PluginConfig;
  instance: { onload: (api: PluginAPI) => void; onunload?: () => void };
}
