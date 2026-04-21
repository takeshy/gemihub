// Creates PluginAPI instances for each plugin

import React from "react";
import ReactDOM from "react-dom";
import type { PluginAPI, PluginView, PluginSettingsTab } from "~/types/plugin";

interface PluginAPICallbacks {
  onRegisterView: (view: PluginView) => void;
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

interface PluginAPIOptions {
  hasPremium?: boolean;
  /** Approved permissions from PluginConfig. Undefined = all (local plugins). */
  permissions?: string[];
  /** Plugin source — local plugins bypass permission checks. */
  source?: "local" | "github";
}

/**
 * Create a PluginAPI instance for a specific plugin
 */
export function createPluginAPI(
  pluginId: string,
  language: string,
  callbacks: PluginAPICallbacks,
  options?: PluginAPIOptions
): PluginAPI {
  // Local plugins bypass permission checks (all APIs available)
  const isLocal = options?.source === "local";
  const hasPermission = (perm: string): boolean =>
    isLocal || !options?.permissions || options.permissions.includes(perm);

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

    registerSettingsTab(tab) {
      callbacks.onRegisterSettingsTab({
        pluginId,
        component: tab.component,
      });
    },

    onActiveFileChanged(callback: (detail: { fileId: string | null; fileName: string | null; mimeType: string | null }) => void): () => void {
      const handler = (e: Event) => callback((e as CustomEvent).detail);
      window.addEventListener("active-file-changed", handler);
      return () => window.removeEventListener("active-file-changed", handler);
    },

    selectFile(fileId: string, fileName: string, mimeType?: string) {
      const mime = mimeType || "text/plain";
      window.dispatchEvent(new CustomEvent("plugin-select-file", { detail: { fileId, fileName, mimeType: mime } }));
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

    React,
    ReactDOM,
  };

  // Permission-gated APIs: gemini, drive, storage
  if (hasPermission("gemini")) {
    api.gemini = {
      async chat(messages, chatOpts) {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messages.map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.content,
              timestamp: Date.now(),
              ...(m.attachments && m.attachments.length > 0
                ? { attachments: m.attachments }
                : {}),
            })),
            model: chatOpts?.model || "gemini-2.5-flash",
            systemPrompt: chatOpts?.systemPrompt,
          }),
        });
        if (!res.ok) throw new Error(`Chat API error: ${res.status}`);
        const text = await res.text();
        const lines = text.split("\n");
        let result = "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
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
    };
  }

  if (hasPermission("drive")) {
    api.drive = {
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
    };
  }

  if (hasPermission("storage")) {
    api.storage = {
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
    };
  }

  // Google Workspace APIs — only attached for premium plan users with matching permission.
  // Plugins can check `api.calendar` / `api.gmail` / `api.sheets` existence
  // to decide whether to show related UI.
  if (options?.hasPremium && hasPermission("calendar")) {
    api.calendar = {
      async listEvents(options = {}) {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", ...options }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Calendar access requires premium plan with calendar permissions");
        }
        if (!res.ok) throw new Error(`Calendar list error: ${res.status}`);
        const data = await res.json();
        return data.events;
      },

      async createEvent(event) {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", ...event }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Calendar access requires premium plan with calendar permissions");
        }
        if (!res.ok) throw new Error(`Calendar create error: ${res.status}`);
        return res.json();
      },

      async updateEvent(eventId, event) {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", eventId, ...event }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Calendar access requires premium plan with calendar permissions");
        }
        if (!res.ok) throw new Error(`Calendar update error: ${res.status}`);
        return res.json();
      },

      async deleteEvent(eventId, calendarId) {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", eventId, calendarId }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Calendar access requires premium plan with calendar permissions");
        }
        if (!res.ok) throw new Error(`Calendar delete error: ${res.status}`);
      },
    };
  }

  if (options?.hasPremium && hasPermission("gmail")) {
    api.gmail = {
      async sendEmail(options) {
        const res = await fetch("/api/gmail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send", ...options }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Gmail access requires premium plan with Gmail permissions");
        }
        if (!res.ok) throw new Error(`Gmail send error: ${res.status}`);
        return res.json();
      },
    };
  }

  if (options?.hasPremium && hasPermission("sheets")) {
    api.sheets = {
      async createSpreadsheet(options) {
        const res = await fetch("/api/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", ...options }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Sheets access requires premium plan with Sheets permissions");
        }
        if (!res.ok) throw new Error(`Sheets create error: ${res.status}`);
        return res.json();
      },

      async writeSheet(options) {
        const res = await fetch("/api/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write", ...options }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Sheets access requires premium plan with Sheets permissions");
        }
        if (!res.ok) throw new Error(`Sheets write error: ${res.status}`);
      },

      async batchWriteSheet(options) {
        const res = await fetch("/api/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "batchWrite", ...options }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Sheets access requires premium plan with Sheets permissions");
        }
        if (!res.ok) throw new Error(`Sheets batchWrite error: ${res.status}`);
      },
    };
  }

  return api;
}
