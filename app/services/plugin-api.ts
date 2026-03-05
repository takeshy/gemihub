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

      async createFile(name: string, content: string | ArrayBuffer) {
        const ext = name.split(".").pop()?.toLowerCase();

        // Binary path: ArrayBuffer → base64 → create-image action
        if (content instanceof ArrayBuffer) {
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
          const base64 = arrayBufferToBase64(content);
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create-image", name, data: base64, mimeType }),
          });
          if (!res.ok) throw new Error(`Drive create error: ${res.status}`);
          const data = await res.json();
          const file = data.file;
          const { setCachedFile, getLocalSyncMeta, setLocalSyncMeta } = await import("~/services/indexeddb-cache");
          await setCachedFile({
            fileId: file.id,
            content: base64,
            md5Checksum: file.md5Checksum ?? "",
            modifiedTime: file.modifiedTime ?? "",
            cachedAt: Date.now(),
            fileName: file.name,
            encoding: "base64",
          });
          // Update localSyncMeta so the file doesn't appear as a pull candidate
          const localMeta = await getLocalSyncMeta();
          if (localMeta) {
            localMeta.files[file.id] = {
              md5Checksum: file.md5Checksum ?? "",
              modifiedTime: file.modifiedTime ?? "",
            };
            localMeta.lastUpdatedAt = data.meta?.lastUpdatedAt || new Date().toISOString();
            await setLocalSyncMeta(localMeta);
          }
          if (data.meta) {
            window.dispatchEvent(new CustomEvent("tree-meta-updated", { detail: { meta: data.meta } }));
          }
          window.dispatchEvent(new Event("sync-complete"));
          return { id: file.id, name: file.name };
        }

        // Text path: existing flow
        const mimeMap: Record<string, string> = {
          md: "text/markdown",
          txt: "text/plain",
          json: "application/json",
          yaml: "text/yaml",
          yml: "text/yaml",
          js: "application/javascript",
          css: "text/css",
          html: "text/html",
        };
        const mimeType = (ext && mimeMap[ext]) || "text/plain";
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", name, content, mimeType, dedup: true }),
        });
        if (!res.ok) throw new Error(`Drive create error: ${res.status}`);
        const data = await res.json();
        const file = data.file;
        // Cache locally so it doesn't appear in Pull diff
        const { setCachedFile, getLocalSyncMeta, setLocalSyncMeta } = await import("~/services/indexeddb-cache");
        await setCachedFile({
          fileId: file.id,
          content,
          md5Checksum: file.md5Checksum ?? "",
          modifiedTime: file.modifiedTime ?? "",
          cachedAt: Date.now(),
          fileName: file.name,
        });
        // Update localSyncMeta so the file doesn't appear as a pull candidate
        const localMeta = await getLocalSyncMeta();
        if (localMeta) {
          localMeta.files[file.id] = {
            md5Checksum: file.md5Checksum ?? "",
            modifiedTime: file.modifiedTime ?? "",
          };
          localMeta.lastUpdatedAt = data.meta?.lastUpdatedAt || new Date().toISOString();
          await setLocalSyncMeta(localMeta);
        }
        if (data.meta) {
          window.dispatchEvent(new CustomEvent("tree-meta-updated", { detail: { meta: data.meta } }));
        }
        window.dispatchEvent(new Event("sync-complete"));
        return { id: file.id, name: file.name };
      },

      async updateFile(fileId: string, content: string | ArrayBuffer) {
        // Update local cache only; user pushes to Drive manually
        const { getCachedFile, setCachedFile } = await import("~/services/indexeddb-cache");
        const cached = await getCachedFile(fileId);
        if (!cached) throw new Error(`File not in local cache: ${fileId}`);

        if (content instanceof ArrayBuffer) {
          // Binary path: base64 cache + binary edit history marker
          const { markBinaryFileModified } = await import("~/services/drive-local");
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
          // Text path: existing flow
          const { saveLocalEdit } = await import("~/services/edit-history-local");
          await saveLocalEdit(fileId, cached.fileName ?? fileId, content);
          await setCachedFile({
            fileId,
            content,
            md5Checksum: cached.md5Checksum ?? "",
            modifiedTime: cached.modifiedTime ?? "",
            cachedAt: Date.now(),
            fileName: cached.fileName,
          });
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
