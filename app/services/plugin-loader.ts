// Client-side plugin loader — handles IndexedDB caching, code execution, and style injection

import type { PluginConfig } from "~/types/settings";
import type { PluginManifest, PluginInstance, PluginAPI } from "~/types/plugin";
import React from "react";
import ReactDOM from "react-dom";

// ---------------------------------------------------------------------------
// IndexedDB cache for plugin assets
// ---------------------------------------------------------------------------

const PLUGIN_DB_NAME = "gemini-hub-plugins";
const PLUGIN_DB_VERSION = 1;

interface CachedPluginAsset {
  key: string; // "{pluginId}:{version}:{fileName}"
  content: string;
}

let pluginDbPromise: Promise<IDBDatabase> | null = null;

function getPluginDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (pluginDbPromise) return pluginDbPromise;

  pluginDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PLUGIN_DB_NAME, PLUGIN_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("assets")) {
        db.createObjectStore("assets", { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => { pluginDbPromise = null; };
      db.onversionchange = () => { db.close(); pluginDbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      pluginDbPromise = null;
      reject(request.error);
    };
  });
  return pluginDbPromise;
}

async function getCachedAsset(pluginId: string, version: string, fileName: string): Promise<string | null> {
  try {
    const db = await getPluginDB();
    const key = `${pluginId}:${version}:${fileName}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("assets", "readonly");
      const req = tx.objectStore("assets").get(key);
      req.onsuccess = () => {
        const result = req.result as CachedPluginAsset | undefined;
        resolve(result?.content ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function setCachedAsset(pluginId: string, version: string, fileName: string, content: string): Promise<void> {
  try {
    const db = await getPluginDB();
    const key = `${pluginId}:${version}:${fileName}`;
    const entry: CachedPluginAsset = { key, content };
    return new Promise((resolve, reject) => {
      const tx = db.transaction("assets", "readwrite");
      const req = tx.objectStore("assets").put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // cache write failure is non-fatal
  }
}

// ---------------------------------------------------------------------------
// Plugin code execution
// ---------------------------------------------------------------------------

function createRequire() {
  const modules: Record<string, unknown> = {
    react: React,
    "react-dom": ReactDOM,
    "react-dom/client": ReactDOM,
  };
  return (name: string): unknown => {
    if (name in modules) return modules[name];
    throw new Error(`Module "${name}" is not available in plugin sandbox`);
  };
}

function executePluginCode(code: string): new () => { onload: (api: PluginAPI) => void; onunload?: () => void } {
  const module = { exports: {} as Record<string, unknown> };
  const require = createRequire();
  const fn = new Function("module", "exports", "require", code);
  fn(module, module.exports, require);
  // Support both module.exports = Class and module.exports.default = Class
  const exported = module.exports;
  if (typeof exported === "function") {
    return exported as new () => { onload: (api: PluginAPI) => void; onunload?: () => void };
  }
  if (typeof (exported as Record<string, unknown>).default === "function") {
    return (exported as Record<string, unknown>).default as new () => { onload: (api: PluginAPI) => void; onunload?: () => void };
  }
  throw new Error("Plugin must export a class with onload method");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a plugin: fetch code (from cache or server), execute, and return instance
 */
export async function loadPlugin(
  config: PluginConfig,
  api: PluginAPI
): Promise<PluginInstance> {
  // Try IndexedDB cache first
  let code = await getCachedAsset(config.id, config.version, "main.js");
  let manifestJson = await getCachedAsset(config.id, config.version, "manifest.json");

  if (!code) {
    const res = await fetch(`/api/plugins/${encodeURIComponent(config.id)}?file=main.js`);
    if (!res.ok) throw new Error(`Failed to fetch plugin ${config.id}: ${res.status}`);
    code = await res.text();
    await setCachedAsset(config.id, config.version, "main.js", code);
  }

  if (!manifestJson) {
    const res = await fetch(`/api/plugins/${encodeURIComponent(config.id)}?file=manifest.json`);
    if (res.ok) {
      manifestJson = await res.text();
      await setCachedAsset(config.id, config.version, "manifest.json", manifestJson);
    }
  }

  const manifest: PluginManifest = manifestJson
    ? JSON.parse(manifestJson)
    : { id: config.id, name: config.id, version: config.version, minAppVersion: "1.0.0", description: "", author: "" };

  // Execute plugin code
  const PluginClass = executePluginCode(code);
  const instance = new PluginClass();

  const pluginInstance: PluginInstance = {
    id: config.id,
    manifest,
    config,
    instance,
    views: [],
    slashCommands: [],
  };

  // Call onload with API
  instance.onload(api);

  return pluginInstance;
}

/**
 * Load plugin styles
 */
export async function loadPluginStyles(config: PluginConfig): Promise<void> {
  let css = await getCachedAsset(config.id, config.version, "styles.css");

  if (!css) {
    const res = await fetch(`/api/plugins/${encodeURIComponent(config.id)}?file=styles.css`);
    if (!res.ok) return; // styles.css is optional
    css = await res.text();
    await setCachedAsset(config.id, config.version, "styles.css", css);
  }

  if (css) {
    // Remove any existing style tag for this plugin
    const existing = document.querySelector(`style[data-plugin="${config.id}"]`);
    if (existing) existing.remove();

    const style = document.createElement("style");
    style.setAttribute("data-plugin", config.id);
    style.textContent = css;
    document.head.appendChild(style);
  }
}

/**
 * Unload a plugin: call onunload, remove styles, clear registrations
 */
export function unloadPlugin(instance: PluginInstance): void {
  try {
    instance.instance.onunload?.();
  } catch {
    // ignore cleanup errors
  }

  // Remove style tag
  const style = document.querySelector(`style[data-plugin="${instance.id}"]`);
  if (style) style.remove();
}
