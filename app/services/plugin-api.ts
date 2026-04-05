// Creates PluginAPI instances for each plugin

import React from "react";
import ReactDOM from "react-dom";
import type { PluginAPI, PluginView, PluginSlashCommand, PluginSettingsTab } from "~/types/plugin";

interface PluginAPICallbacks {
  onRegisterView: (view: PluginView) => void;
  onRegisterSlashCommand: (cmd: PluginSlashCommand) => void;
  onRegisterSettingsTab: (tab: PluginSettingsTab) => void;
}

/** Convert ArrayBuffer to base64 string */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
      const namespacedViewId = `${pluginId}:${view.id}`;
      callbacks.onRegisterView({
        id: namespacedViewId,
        pluginId,
        name: view.name,
        icon: view.icon,
        location: view.location,
        extensions: view.extensions,
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
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue; // skip non-JSON lines
            }
            if (data.type === "error") {
              throw new Error((data.error || data.content || "Gemini API error") as string);
            }
            if (data.type === "text" && data.content) {
              result += data.content;
            }
          }
        }
        return result;
      },
    },

    drive: {
      async readFile(fileId: string) {
        const { readFileLocal } = await import("~/services/drive-local");
        return readFileLocal(fileId);
      },

      async searchFiles(query: string) {
        const { searchFilesLocal } = await import("~/services/drive-local");
        return searchFilesLocal(query);
      },

      async listFiles(folder?: string) {
        const { listFilesLocal, mimeTypeFromFileName } = await import("~/services/drive-local");
        const { files } = await listFilesLocal(folder, { limit: 1000 });
        return files.map((f) => ({ id: f.id, name: f.name, mimeType: mimeTypeFromFileName(f.name) }));
      },

      async createFile(name: string, content: string | ArrayBuffer) {
        if (content instanceof ArrayBuffer) {
          const { saveBinaryFileLocal } = await import("~/services/drive-local");
          const base64 = arrayBufferToBase64(content);
          const ext = name.split(".").pop()?.toLowerCase();
          const binaryMimeMap: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
            pdf: "application/pdf",
            bmp: "image/bmp",
            ico: "image/x-icon",
            tiff: "image/tiff",
            tif: "image/tiff",
          };
          const mimeType = (ext && binaryMimeMap[ext]) || "application/octet-stream";
          const { fileId } = await saveBinaryFileLocal(name, base64, mimeType);
          return { id: fileId, name };
        }

        const { writeFileLocal } = await import("~/services/drive-local");
        const { fileId } = await writeFileLocal(name, content as string);
        return { id: fileId, name };
      },

      async updateFile(fileId: string, content: string | ArrayBuffer) {
        const { getCachedFile } = await import("~/services/indexeddb-cache");
        let cached = await getCachedFile(fileId);
        // After pending-file migration, "new:*" IDs are replaced with real Drive IDs.
        // Fall back to name-based lookup so plugins holding stale IDs still work.
        if (!cached && fileId.startsWith("new:")) {
          const { findFileByNameLocal } = await import("~/services/drive-local");
          const found = await findFileByNameLocal(fileId.slice(4));
          if (found) {
            fileId = found.id;
            cached = await getCachedFile(fileId);
          }
        }
        if (!cached) throw new Error(`File not in local cache: ${fileId}`);

        if (content instanceof ArrayBuffer) {
          const { markBinaryFileModified } = await import("~/services/drive-local");
          const { setCachedFile } = await import("~/services/indexeddb-cache");
          const base64 = arrayBufferToBase64(content);
          await markBinaryFileModified(fileId, cached.fileName ?? fileId);
          await setCachedFile({
            fileId,
            content: base64,
            md5Checksum: cached.md5Checksum ?? "",
            modifiedTime: cached.modifiedTime ?? "",
            cachedAt: Date.now(),
            fileName: cached.fileName,
            encoding: "base64",
          });
        } else {
          const { writeFileLocal } = await import("~/services/drive-local");
          await writeFileLocal(cached.fileName ?? fileId, content as string, { existingFileId: fileId });
        }

        window.dispatchEvent(
          new CustomEvent("file-modified", { detail: { fileId } })
        );
      },

      async rebuildTree() {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rebuildTree" }),
        });
        if (!res.ok) throw new Error(`Rebuild tree error: ${res.status}`);
        window.dispatchEvent(new Event("sync-complete"));
      },
    },

    assets: {
      async fetch(name: string) {
        const res = await fetch(
          `/api/plugins/${encodeURIComponent(pluginId)}?asset=${encodeURIComponent(name)}`
        );
        if (!res.ok) throw new Error(`Asset fetch error: ${res.status}`);
        return res.arrayBuffer();
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
