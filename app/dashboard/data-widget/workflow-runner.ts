// Workflow source — execution, row extraction, and sidecar cache.
//
// CRITICAL INVARIANT (P2 spec §9.1): This module MUST NOT be called from
// any onload/render path. Execution is triggered only by:
//   (a) The refresh button in the widget header
//   (b) The "Test run" button in the config editor (creation / config change)
// The widget's render path reads only from the sidecar cache.

import { parseWorkflowYaml } from "~/engine/parser";
import { executeWorkflowLocally } from "~/engine/local-executor";
import type { ExecutionRecord } from "~/engine/types";
import { readFileLocal, writeFileLocal } from "~/services/drive-local";
import { getCachedApiKey } from "~/services/api-key-cache";
import {
  getCachedFile,
  setCachedFile,
  getCachedRemoteMeta,
  getAllCachedFiles,
} from "~/services/indexeddb-cache";
import { processDriveEvent } from "~/utils/drive-file-local";
import { getCachedLoaderDataInMemory } from "~/routes/_index";
import type {
  WorkflowCacheRecord,
  WorkflowRowsResult,
  WorkflowTextResult,
} from "./types";
import { detectFields, fieldsToMap } from "./filter";

// --- Workflow file resolution ---

/**
 * Resolve a workflow file path/name to a fileId.
 * Checks CachedRemoteMeta first, then scans all cached files.
 */
export async function resolveWorkflowFileId(
  workflowPath: string,
): Promise<string | null> {
  if (!workflowPath) return null;

  const basename = (p: string) => p.split("/").pop() ?? p;
  const targetBase = basename(workflowPath);

  const meta = await getCachedRemoteMeta();
  if (meta) {
    const entries = Object.entries(meta.files);
    // 1. Exact full-path match (preferred).
    for (const [id, entry] of entries) {
      if (entry.name === workflowPath) return id;
    }
    // 2. Basename fallback — tolerates configs that stored just the file name
    //    (older widgets) or a path that differs only by folder prefix.
    for (const [id, entry] of entries) {
      if (basename(entry.name) === targetBase) return id;
    }
  }

  const allFiles = await getAllCachedFiles();
  for (const f of allFiles) {
    if (f.fileName === workflowPath) return f.fileId;
  }
  for (const f of allFiles) {
    if (f.fileName && basename(f.fileName) === targetBase) return f.fileId;
  }

  return null;
}

// --- Row extraction from execution result ---

/**
 * Extract rows (array of objects) from the workflow execution result.
 *
 * Strategy:
 * 1. If outputVariable is specified, use that variable.
 * 2. Otherwise, scan all non-`_`-prefixed variables for one that parses
 *    to an array of objects.
 *
 * Variables are Map<string, string | number>, but the `script` node can
 * store raw objects/arrays. JSON strings are parsed.
 */
export function extractRows(
  variables: Map<string, string | number>,
  outputVariable?: string,
): Record<string, unknown>[] | null {
  const tryParse = (value: unknown): Record<string, unknown>[] | null => {
    if (value == null) return null;
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (!Array.isArray(parsed)) return null;
    if (parsed.length === 0) return [];
    if (typeof parsed[0] !== "object" || parsed[0] === null) return null;
    return parsed as Record<string, unknown>[];
  };

  if (outputVariable) {
    const v = variables.get(outputVariable);
    const rows = tryParse(v);
    return rows;
  }

  for (const [key, value] of variables) {
    if (key.startsWith("_")) continue;
    const rows = tryParse(value);
    if (rows) return rows;
  }

  return null;
}

/**
 * Extract a string output (markdown / html) from the execution result.
 *
 * Strategy:
 * 1. If outputVariable is specified, use that variable (coerced to string).
 * 2. Otherwise prefer `result`, then the first non-`_`-prefixed string variable.
 *
 * Objects/arrays are NOT valid string output (returns null).
 */
export function extractString(
  variables: Map<string, string | number>,
  outputVariable?: string,
): string | null {
  const toStr = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return null;
  };

  if (outputVariable) {
    return toStr(variables.get(outputVariable));
  }

  const fromResult = toStr(variables.get("result"));
  if (fromResult != null) return fromResult;

  for (const [key, value] of variables) {
    if (key.startsWith("_")) continue;
    const s = toStr(value);
    if (s != null && s.length > 0) return s;
  }

  return null;
}

// --- Execution history (shared with normal/scheduled executions) ---

/** Save a run to Drive execution history (keyed by record.workflowId). */
async function saveExecutionHistory(record: ExecutionRecord): Promise<void> {
  const res = await fetch("/api/workflow/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", record }),
  });
  if (!res.ok) throw new Error("Failed to save execution history");
}

// --- Workflow execution ---

/**
 * Execute a workflow headlessly and return its final variables.
 * All prompts are auto-resolved to null; failures throw with the real cause.
 *
 * Only call from explicit user actions (refresh button, test-run) or the
 * dashboard-open interval auto-run. NEVER from a per-render/effect path that
 * runs on every mount regardless of staleness.
 */
async function executeWorkflowVariables(
  workflowFileId: string,
  abortSignal?: AbortSignal,
): Promise<Map<string, string | number>> {
  const content = await readFileLocal(workflowFileId);
  const workflow = parseWorkflowYaml(content);

  const settings = getCachedLoaderDataInMemory()?.settings as
    import("~/types/settings").UserSettings | undefined;

  // Capture the last error log so a failed node's real message can be surfaced
  // (otherwise the user only sees a generic "did not complete" with no cause).
  let lastErrorLog: string | null = null;

  const result = await executeWorkflowLocally(
    workflow,
    {
      onLog: (log) => {
        if (log.status === "error") lastErrorLog = log.message;
      },
      onDriveEvent: (event) => {
        processDriveEvent(event).catch(() => {});
      },
      promptCallbacks: {
        promptForValue: async () => null,
        promptForDialog: async () => null,
        promptForDriveFile: async () => null,
        promptForDiff: async () => true,
        promptForPassword: async () => null,
      },
    },
    {
      workflowId: workflowFileId,
      geminiApiKey: getCachedApiKey() || undefined,
      settings,
      canUseProxy: true,
      executionMode: settings?.apiPlan === "paid" ? "server" : "local",
      // Headless: there is no UI to answer prompts, so prompt nodes resolve to
      // null. This also routes paid-plan execution through the server path.
      promptMode: "headless",
      abortSignal,
    },
  );

  // Persist the run to execution history (best-effort, non-blocking) so a
  // failed dashboard run can be inspected / fed back to "Modify with AI" from
  // the history picker, exactly like a normal IDE/scheduled execution.
  saveExecutionHistory(result.historyRecord).catch(() => {});

  if (result.historyRecord.status !== "completed") {
    // Surface the real cause rather than a generic message. Prefer the failing
    // step's recorded error, then the last error log.
    const errorStep = [...result.historyRecord.steps]
      .reverse()
      .find((s) => s.status === "error" && s.error);

    // Interactive nodes can't run unattended in a dashboard — give a specific
    // hint instead of the raw "Input cancelled by user".
    const INTERACTIVE_NODES = new Set([
      "prompt-value",
      "prompt-file",
      "prompt-selection",
      "dialog",
      "drive-file-picker",
    ]);
    if (errorStep && INTERACTIVE_NODES.has(errorStep.nodeType)) {
      throw new Error(
        `This workflow uses an interactive '${errorStep.nodeType}' node, which can't run unattended in a dashboard. ` +
          "Rebuild it to source inputs from Drive nodes or fixed values (no prompt/dialog nodes).",
      );
    }

    const detail = errorStep
      ? `${errorStep.nodeType} node: ${errorStep.error}`
      : lastErrorLog;
    throw new Error(
      detail
        ? `Workflow failed — ${detail}`
        : "Workflow execution did not complete successfully (no nodes ran — check that the workflow has a start node and produces output).",
    );
  }

  return result.context.variables;
}

/**
 * Execute a workflow and extract rows for a card/table output.
 * Only call from explicit user actions or the interval auto-run.
 */
export async function runWorkflowRows(
  workflowFileId: string,
  outputVariable?: string,
  abortSignal?: AbortSignal,
): Promise<WorkflowRowsResult> {
  const variables = await executeWorkflowVariables(workflowFileId, abortSignal);
  const rows = extractRows(variables, outputVariable);
  if (rows === null) {
    throw new Error(
      "Workflow output is not an array of objects. Ensure the workflow produces a JSON array of objects.",
    );
  }
  const fields = detectFields(rows);
  return { rows, fields: fieldsToMap(fields) };
}

/**
 * Execute a workflow and extract a string for a markdown/html output.
 * Only call from explicit user actions or the interval auto-run.
 */
export async function runWorkflowText(
  workflowFileId: string,
  outputVariable?: string,
  abortSignal?: AbortSignal,
): Promise<WorkflowTextResult> {
  const variables = await executeWorkflowVariables(workflowFileId, abortSignal);
  const text = extractString(variables, outputVariable);
  if (text === null) {
    throw new Error(
      "Workflow output is not a string. Ensure the workflow stores its Markdown/HTML output (e.g. in `result`).",
    );
  }
  return { text };
}

// --- Sidecar cache (P2 spec §9.2) ---

const CACHE_PREFIX = "dashboards/data/";

function cacheFilePath(dashboardFileId: string): string {
  return `${CACHE_PREFIX}${dashboardFileId}.json`;
}

/**
 * Load the workflow cache for a dashboard.
 * Returns all widget caches for this dashboard.
 */
async function loadCacheFile(
  dashboardFileId: string,
): Promise<Record<string, WorkflowCacheRecord>> {
  // Resolve the cache file by its path via CachedRemoteMeta, then read from cache.
  // The cache file is stored at `dashboards/data/<dashboardFileId>.json` and is a
  // normal synced file (visible in the tree / push-pull diff).
  const meta = await getCachedRemoteMeta();
  if (!meta) return {};

  const path = cacheFilePath(dashboardFileId);
  for (const [id, entry] of Object.entries(meta.files)) {
    if (entry.name !== path) continue;

    let file = await getCachedFile(id);
    // The cache syncs across devices, but a machine that never ran the workflow
    // only has it registered as metadata (new remote files are not downloaded by
    // pull). Lazy-fetch the content so its dashboard still shows the results.
    // Also re-fetch when the remote copy is newer (another device pushed a run).
    const stale = file != null && entry.md5Checksum != null && file.md5Checksum !== entry.md5Checksum;
    if ((!file || stale) && !id.startsWith("new:")) {
      try {
        const res = await fetch(`/api/drive/files?action=read&fileId=${id}`);
        if (res.ok) {
          const data = await res.json();
          await setCachedFile({
            fileId: id,
            content: data.content,
            md5Checksum: data.md5Checksum ?? "",
            modifiedTime: data.modifiedTime ?? "",
            cachedAt: Date.now(),
            fileName: path,
          });
          file = await getCachedFile(id);
        }
      } catch {
        // Offline or fetch failed — fall back to whatever is cached locally.
      }
    }

    if (file) {
      try {
        return JSON.parse(file.content) as Record<string, WorkflowCacheRecord>;
      } catch {
        return {};
      }
    }
  }

  return {};
}

/**
 * Save the workflow cache for a dashboard.
 * Uses last-write-wins (regenerable data, P2 spec §9.2).
 * Cache conflicts must NOT block .dashboard saves.
 */
async function saveCacheFile(
  dashboardFileId: string,
  caches: Record<string, WorkflowCacheRecord>,
): Promise<void> {
  const path = cacheFilePath(dashboardFileId);
  const content = JSON.stringify(caches, null, 2);
  await writeFileLocal(path, content);
}

/**
 * Load the cached result for a specific widget.
 * Returns null if no cache exists.
 */
export async function loadWidgetCache(
  dashboardFileId: string,
  widgetId: string,
): Promise<WorkflowCacheRecord | null> {
  if (!dashboardFileId) return null;
  const caches = await loadCacheFile(dashboardFileId);
  return caches[widgetId] ?? null;
}

/**
 * Save the cached result for a specific widget.
 * Merges with existing caches (other widgets in the same dashboard).
 */
export async function saveWidgetCache(
  dashboardFileId: string,
  widgetId: string,
  record: WorkflowCacheRecord,
): Promise<void> {
  if (!dashboardFileId) return;
  const caches = await loadCacheFile(dashboardFileId);
  caches[widgetId] = record;
  await saveCacheFile(dashboardFileId, caches);
}
