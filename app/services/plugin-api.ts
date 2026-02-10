// Creates PluginAPI instances for each plugin

import React from "react";
import ReactDOM from "react-dom";
import type { PluginAPI, PluginView, PluginSlashCommand, PluginSettingsTab } from "~/types/plugin";

interface PluginAPICallbacks {
  onRegisterView: (view: PluginView) => void;
  onRegisterSlashCommand: (cmd: PluginSlashCommand) => void;
  onRegisterSettingsTab: (tab: PluginSettingsTab) => void;
}

/**
 * Create a PluginAPI instance for a specific plugin
 */
export function createPluginAPI(
  pluginId: string,
  language: string,
  callbacks: PluginAPICallbacks
): PluginAPI {
  const api: PluginAPI = {
    language,

    registerView(view) {
      callbacks.onRegisterView({
        id: view.id,
        pluginId,
        name: view.name,
        icon: view.icon,
        location: view.location,
        component: view.component,
      });
    },

    registerSlashCommand(cmd) {
      callbacks.onRegisterSlashCommand({
        pluginId,
        name: cmd.name,
        description: cmd.description,
        execute: cmd.execute,
      });
    },

    registerSettingsTab(tab) {
      callbacks.onRegisterSettingsTab({
        pluginId,
        component: tab.component,
      });
    },

    gemini: {
      async chat(messages, options) {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messages.map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.content,
              timestamp: Date.now(),
            })),
            model: options?.model || "gemini-2.5-flash",
            systemPrompt: options?.systemPrompt,
          }),
        });
        if (!res.ok) throw new Error(`Chat API error: ${res.status}`);
        const text = await res.text();
        // Parse SSE response to extract text
        const lines = text.split("\n");
        let result = "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "text" && data.content) {
                result += data.content;
              }
            } catch {
              // skip non-JSON lines
            }
          }
        }
        return result;
      },
    },

    drive: {
      async readFile(fileId: string) {
        const res = await fetch(
          `/api/drive/files?action=read&fileId=${encodeURIComponent(fileId)}`
        );
        if (!res.ok) throw new Error(`Drive read error: ${res.status}`);
        const data = await res.json();
        return data.content;
      },

      async searchFiles(query: string) {
        const res = await fetch(
          `/api/drive/files?action=search&query=${encodeURIComponent(query)}`
        );
        if (!res.ok) throw new Error(`Drive search error: ${res.status}`);
        const data = await res.json();
        return data.files;
      },

      async listFiles(folderId?: string) {
        const params = new URLSearchParams({ action: "list" });
        if (folderId) params.set("folderId", folderId);
        const res = await fetch(`/api/drive/files?${params}`);
        if (!res.ok) throw new Error(`Drive list error: ${res.status}`);
        const data = await res.json();
        return data.files;
      },

      async createFile(name: string, content: string) {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", name, content }),
        });
        if (!res.ok) throw new Error(`Drive create error: ${res.status}`);
        const data = await res.json();
        window.dispatchEvent(new Event("sync-complete"));
        return { id: data.file.id, name: data.file.name };
      },

      async updateFile(fileId: string, content: string) {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", fileId, content }),
        });
        if (!res.ok) throw new Error(`Drive update error: ${res.status}`);
      },
    },

    storage: {
      async get(key: string) {
        const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getData" }),
        });
        if (!res.ok) throw new Error(`Storage get error: ${res.status}`);
        const { data } = await res.json();
        return data?.[key];
      },

      async set(key: string, value: unknown) {
        const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "setData", key, value }),
        });
        if (!res.ok) throw new Error(`Storage set error: ${res.status}`);
      },

      async getAll() {
        const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getData" }),
        });
        if (!res.ok) throw new Error(`Storage getAll error: ${res.status}`);
        const { data } = await res.json();
        return data || {};
      },
    },

    React,
    ReactDOM,
  };

  return api;
}
