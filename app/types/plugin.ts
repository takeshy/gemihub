// Plugin system type definitions

import type React from "react";
import type { PluginConfig } from "~/types/settings";

/** manifest.json schema */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
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
      content: string
    ): Promise<{ id: string; name: string }>;
    updateFile(fileId: string, content: string): Promise<void>;
    rebuildTree(): Promise<void>;
  };

  // Plugin-scoped storage (data.json on Drive)
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    getAll(): Promise<Record<string, unknown>>;
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
