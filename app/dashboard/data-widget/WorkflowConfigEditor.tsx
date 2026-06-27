// Config editor for the `workflow` widget.
// Picks a workflow (or creates/modifies one via the AI modal), chooses an output
// format (card / table / markdown / html), runs it, and configures the output.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Sparkles,
} from "lucide-react";
import { useEditorContext } from "~/contexts/EditorContext";
import { useI18n } from "~/i18n/context";
import type { TranslationStrings } from "~/i18n/translations";
import { writeFileLocal, readFileLocal } from "~/services/drive-local";
import { SKILLS_FOLDER_NAME } from "~/types/settings";
import { getCachedLoaderDataInMemory } from "~/routes/_index";
import { AIWorkflowDialog } from "~/components/ide/AIWorkflowDialog";
import type { ConfigEditorProps } from "../types";
import type {
  WorkflowWidgetConfig,
  WorkflowOutput,
  FieldInfo,
  CardMapping,
  PropertyType,
} from "./types";
import {
  resolveWorkflowFileId,
  runWorkflowRows,
  runWorkflowText,
  saveWidgetCache,
  loadWidgetCache,
} from "./workflow-runner";
import {
  FilterEditor,
  SortLimitFields,
  ColumnsEditor,
  CardMappingEditor,
  buildSortOptions,
} from "./config-parts";

const OUTPUT_OPTIONS: { value: WorkflowOutput; labelKey: keyof TranslationStrings }[] = [
  { value: "card", labelKey: "dashboard.outputCard" },
  { value: "table", labelKey: "dashboard.outputTable" },
  { value: "markdown", labelKey: "dashboard.outputMarkdown" },
  { value: "html", labelKey: "dashboard.outputHtml" },
];

/**
 * Output-format contract appended to the AI workflow-generation prompt.
 * card/table → JSON array of row objects; markdown/html → a single string.
 */
function buildFormatGuidance(cfg: WorkflowWidgetConfig): string {
  const output = cfg.output ?? "table";
  const lines: string[] = [
    "RUNS UNATTENDED: This workflow executes headlessly in a dashboard (no user " +
      "present), so it MUST NOT use any interactive node — no `prompt-value`, " +
      "`prompt-file`, `prompt-selection`, or `dialog`. Source every input from " +
      "Drive nodes (drive-list, drive-read, drive-search, etc.), `variable`/`set` " +
      "defaults, or hardcoded values. Any node that waits for user input will fail.",
  ];
  if (output === "markdown" || output === "html") {
    const kind = output === "html" ? "HTML" : "Markdown";
    lines.push(
      `OUTPUT CONTRACT (this workflow feeds a dashboard widget): The final node MUST ` +
        `produce a single ${kind} string and store it with \`saveTo: result\`. Prefer a ` +
        `\`script\` node whose \`return\` value is that string. Do NOT return a JSON array.`,
    );
  } else {
    lines.push(
      "OUTPUT CONTRACT (this workflow feeds a dashboard data widget): The final node " +
        "MUST produce a JSON array of objects — one object per row — and store it with " +
        "`saveTo: result`. Prefer a `script` node whose `return` value is that array. " +
        "Each object's keys become the row's columns/fields. Do NOT return prose.",
    );
    lines.push(
      "IMAGES: when a row has an image, reference an EXISTING Drive image with an " +
        "Obsidian internal embed like `![[folder/cover.png]]` (or a plain Drive path " +
        "such as `folder/cover.png`, a file ID, or an https URL). Do NOT inline a " +
        "`data:image/...;base64,...` value for existing files — base64 bloats the saved " +
        "result. Only emit base64 when the workflow itself generates a brand-new image " +
        "that isn't saved as a Drive file.",
    );
    if (output === "card") {
      const card = cfg.card ?? {};
      const keys = [card.title, card.subtitle, card.image, card.body, ...(card.badges ?? [])]
        .filter((k): k is string => typeof k === "string" && k.length > 0);
      lines.push(
        keys.length > 0
          ? `The widget renders cards using these object keys: ${keys.join(", ")}. Include them on every row object.`
          : "The widget renders cards: give each row object a clear human-readable title key plus any fields worth showing.",
      );
    } else {
      const cols = cfg.columns ?? [];
      lines.push(
        cols.length > 0
          ? `The widget renders a table with these columns: ${cols.join(", ")}. Each row object must include these keys.`
          : "The widget renders a table: choose clear, consistent keys for each row object — they become the columns.",
      );
    }
  }
  return lines.join("\n");
}

// --- Card mapping auto-seed (mirrors table column seeding) ---
// A freshly created card widget has no field mapping, so without this every
// slot (title/image/…) is empty and cards render blank. After a test run we
// guess a sensible mapping from the detected field names + sampled values.

const IMAGE_NAME_RE = /^(image|img|photo|picture|pic|cover|thumbnail|thumb|icon|avatar|logo)s?$/i;
const TITLE_NAME_RE = /^(title|name|heading|label)s?$/i;
const SUBTITLE_NAME_RE = /^(subtitle|status|state|category|type|author|owner)s?$/i;
const BODY_NAME_RE = /^(body|text|summary|description|desc|content|excerpt|note)s?$/i;
const BADGE_NAME_RE = /^(tag|badge|label|keyword)s?$/i;

function looksLikeImageValue(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.startsWith("data:image/")) return true;
  if (/^https?:\/\/.+\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(s)) return true;
  // Obsidian embed/link `![[path]]` / `[[path]]`, or a bare Drive path to an image.
  const inner = s.match(/^!?\[\[([^\]]+)\]\]$/)?.[1] ?? s;
  return /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(inner);
}

function seedCardMapping(
  fields: FieldInfo[],
  rows: Record<string, unknown>[],
): CardMapping {
  const names = fields.map((f) => f.name);
  const sample = (name: string) => rows.slice(0, 5).map((r) => r[name]);
  const used = new Set<string>();
  const take = (name: string | undefined): string | undefined => {
    if (!name || used.has(name)) return undefined;
    used.add(name);
    return name;
  };

  const card: CardMapping = {};
  // Image: prefer a name match, else any field whose values look like images.
  card.image = take(
    names.find((n) => IMAGE_NAME_RE.test(n)) ??
      names.find((n) => sample(n).some(looksLikeImageValue)),
  );
  card.title = take(
    names.find((n) => TITLE_NAME_RE.test(n)) ?? names.find((n) => !used.has(n)),
  );
  card.subtitle = take(names.find((n) => SUBTITLE_NAME_RE.test(n)));
  card.body = take(names.find((n) => BODY_NAME_RE.test(n)));
  const badge = take(names.find((n) => BADGE_NAME_RE.test(n)));
  if (badge) card.badges = [badge];

  // Drop undefined slots so the saved config stays clean.
  return Object.fromEntries(
    Object.entries(card).filter(([, v]) => v != null),
  ) as CardMapping;
}

type TestResult =
  | { status: "ok"; kind: "rows"; rows: Record<string, unknown>[] }
  | { status: "ok"; kind: "text"; text: string }
  | { status: "error"; error: string };

export function WorkflowConfigEditor({ config, onChange, widgetId, dashboardFileId, dashboardFileName }: ConfigEditorProps) {
  const { t } = useI18n();
  const { fileList } = useEditorContext();
  const cfg = useMemo(() => (config ?? {}) as WorkflowWidgetConfig, [config]);
  const output = cfg.output ?? "table";
  const isText = output === "markdown" || output === "html";
  const dashboardCacheKey = dashboardFileName ?? dashboardFileId;

  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const testAbortRef = useRef<AbortController | null>(null);
  // AI dialog: opened in "modify" mode (with the selected workflow's YAML +
  // fileId so its history picker works) when a workflow is chosen, else "create".
  const [aiDialog, setAiDialog] = useState<
    | { mode: "create" }
    | { mode: "modify"; currentYaml: string; currentName: string; workflowId: string }
    | null
  >(null);

  const loaderSettings = getCachedLoaderDataInMemory()?.settings;
  // Match the app-wide default (DEFAULT_USER_SETTINGS.apiPlan === "paid", and
  // getAvailableModels treats anything other than "free" as paid). Falling back
  // to "free" here would hide paid models (e.g. Gemini 3.1 Pro) whenever the
  // cached loader data is momentarily unavailable.
  const apiPlan = loaderSettings?.apiPlan ?? "paid";
  const encryptedPrivateKey = loaderSettings?.encryption?.encryptedPrivateKey;
  const salt = loaderSettings?.encryption?.salt;

  // Field names offered in the mapping dropdowns: detected fields, unioned with
  // whatever the config already references so a saved mapping shows its current
  // value even before a run re-detects fields.
  const fieldNames = useMemo(() => {
    const names = fields.map((f) => f.name);
    const seen = new Set(names);
    const card = cfg.card ?? {};
    const configured = [
      card.title, card.subtitle, card.image, card.body,
      ...(card.badges ?? []),
      ...(cfg.columns ?? []),
    ];
    for (const key of configured) {
      if (typeof key === "string" && key && !seen.has(key)) {
        seen.add(key);
        names.push(key);
      }
    }
    return names;
  }, [fields, cfg.card, cfg.columns]);
  const fieldTypeMap = useMemo(
    () => new Map(fields.map((f) => [f.name, f.type] as const)),
    [fields],
  );
  const sortOptions = useMemo(() => buildSortOptions(fields, true), [fields]);

  const update = useCallback(
    (patch: Partial<WorkflowWidgetConfig>) => onChange({ ...cfg, ...patch }),
    [cfg, onChange],
  );

  // Selectable workflows: .yaml/.yml, excluding skill-bundled and web-published
  // ones (skills/… and web/… are not meant to back dashboard widgets).
  const workflowFiles = useMemo(
    () =>
      fileList.filter((f) => {
        if (!f.name.endsWith(".yaml") && !f.name.endsWith(".yml")) return false;
        const path = f.path ?? f.name;
        return !path.startsWith(`${SKILLS_FOLDER_NAME}/`) && !path.startsWith("web/");
      }),
    [fileList],
  );

  // Seed detected fields from the last cached run on mount, so the mapping
  // dropdowns are populated (and show the current selection) without re-running.
  useEffect(() => {
    if (!widgetId || !dashboardCacheKey) return;
    let cancelled = false;
    (async () => {
      const cached = await loadWidgetCache(dashboardCacheKey, widgetId);
      if (cancelled || !cached?.fields) return;
      setFields(
        Object.entries(cached.fields).map(([name, type]) => ({
          name,
          type: type as PropertyType,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetId, dashboardCacheKey]);

  // --- Run ---
  const handleTestRun = useCallback(async () => {
    if (!widgetId || !dashboardCacheKey || testing || !cfg.workflow) return;

    setTesting(true);
    testAbortRef.current?.abort();
    const abortController = new AbortController();
    testAbortRef.current = abortController;

    try {
      const workflowFileId = await resolveWorkflowFileId(cfg.workflow);
      if (!workflowFileId) throw new Error(t("dashboard.workflowNotFound"));

      if (isText) {
        const result = await runWorkflowText(workflowFileId, cfg.outputVariable, abortController.signal);
        if (abortController.signal.aborted) return;
        await saveWidgetCache(dashboardCacheKey, widgetId, {
          widgetId,
          ranAt: Date.now(),
          status: "ok",
          text: result.text,
        });
        setTestResult({ status: "ok", kind: "text", text: result.text });
      } else {
        const result = await runWorkflowRows(workflowFileId, cfg.outputVariable, abortController.signal);
        if (abortController.signal.aborted) return;
        await saveWidgetCache(dashboardCacheKey, widgetId, {
          widgetId,
          ranAt: Date.now(),
          status: "ok",
          rows: result.rows,
          fields: result.fields,
        });
        const detectedFields: FieldInfo[] = Object.entries(result.fields).map(
          ([name, type]) => ({ name, type: type as PropertyType }),
        );
        setFields(detectedFields);
        // Seed the output mapping from detected fields if not set yet, so a
        // freshly created widget renders something instead of blank rows/cards.
        if (output === "table" && (!cfg.columns || cfg.columns.length === 0) && detectedFields.length > 0) {
          onChange({ ...cfg, columns: detectedFields.map((f) => f.name) });
        } else if (
          output === "card" &&
          (!cfg.card || Object.keys(cfg.card).length === 0) &&
          detectedFields.length > 0
        ) {
          onChange({ ...cfg, card: seedCardMapping(detectedFields, result.rows) });
        }
        setTestResult({ status: "ok", kind: "rows", rows: result.rows });
      }
    } catch (err) {
      if (abortController.signal.aborted) return;
      const errorMsg = err instanceof Error ? err.message : t("dashboard.workflowError");
      setTestResult({ status: "error", error: errorMsg });
    } finally {
      if (testAbortRef.current === abortController) {
        testAbortRef.current = null;
        setTesting(false);
      }
    }
  }, [widgetId, dashboardCacheKey, testing, cfg, isText, output, onChange, t]);

  // Auto-run when the selected workflow CHANGES (explicit user action).
  // Seeded with the workflow at mount so merely opening settings doesn't run it.
  const prevWorkflowRef = useRef<string | undefined>(cfg.workflow);
  useEffect(() => {
    const current = cfg.workflow;
    if (current && current !== prevWorkflowRef.current && widgetId && dashboardCacheKey) {
      handleTestRun();
    }
    prevWorkflowRef.current = current;
  }, [cfg.workflow, widgetId, dashboardCacheKey, handleTestRun]);

  useEffect(() => {
    return () => {
      testAbortRef.current?.abort();
    };
  }, []);

  const formatGuidance = useMemo(() => buildFormatGuidance(cfg), [cfg]);

  // Open the AI dialog: "modify" the selected workflow (loading its YAML +
  // fileId so the execution-history picker works), or "create" a new one.
  const openAIDialog = useCallback(async () => {
    if (cfg.workflow) {
      const fileId = await resolveWorkflowFileId(cfg.workflow);
      if (fileId) {
        const yaml = await readFileLocal(fileId);
        setAiDialog({
          mode: "modify",
          currentYaml: yaml,
          currentName: cfg.workflow.split("/").pop() ?? cfg.workflow,
          workflowId: fileId,
        });
        return;
      }
    }
    setAiDialog({ mode: "create" });
  }, [cfg.workflow]);

  const handleWorkflowAccepted = useCallback(
    async (yaml: string, name: string) => {
      // Modify writes back to the existing file; create makes a new one.
      const path =
        aiDialog?.mode === "modify"
          ? (cfg.workflow as string)
          : `workflows/${name.endsWith(".yaml") || name.endsWith(".yml") ? name : `${name}.yaml`}`;
      await writeFileLocal(path, yaml, { existingFileId: aiDialog?.mode === "modify" ? aiDialog.workflowId : undefined });
      setAiDialog(null);
      onChange({ ...cfg, workflow: path, outputVariable: cfg.outputVariable ?? "result" });
    },
    [aiDialog, cfg, onChange],
  );

  return (
    <div className="space-y-4">
      {/* Output format */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.outputFormat")}
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {OUTPUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ output: opt.value })}
              className={`rounded-md border px-2 py-1.5 text-xs ${
                output === opt.value
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
        <span>{t("dashboard.showWidgetHeader")}</span>
        <input
          type="checkbox"
          checked={cfg.showHeader !== false}
          onChange={(e) => update({ showHeader: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      </label>

      {/* Workflow source */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.sourceWorkflow")}
        </label>
        <div className="space-y-2">
          <select
            value={cfg.workflow ?? ""}
            onChange={(e) => update({ workflow: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">{t("dashboard.selectWorkflow")}</option>
            {workflowFiles.map((f) => (
              <option key={f.id} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={openAIDialog}
            className="flex items-center gap-1.5 rounded-md border border-purple-300 dark:border-purple-700 px-3 py-1.5 text-sm text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30"
          >
            <Sparkles size={14} />
            {cfg.workflow ? t("dashboard.modifyWorkflowAI") : t("dashboard.createWorkflowAI")}
          </button>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
              {t("dashboard.outputVariable")}
            </label>
            <input
              type="text"
              value={cfg.outputVariable ?? ""}
              onChange={(e) => update({ outputVariable: e.target.value || undefined })}
              placeholder={t("dashboard.outputVariablePlaceholder")}
              className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestRun}
              disabled={testing || !cfg.workflow}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              <RefreshCw size={14} className={testing ? "animate-spin" : ""} />
              {testing ? t("dashboard.executing") : t("dashboard.run")}
            </button>
            {testing && (
              <button
                type="button"
                onClick={() => {
                  testAbortRef.current?.abort();
                  testAbortRef.current = null;
                  setTesting(false);
                }}
                className="flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-700 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
              >
                <XCircle size={14} />
                {t("dashboard.cancel")}
              </button>
            )}
          </div>

          {/* Test result preview */}
          {testResult?.status === "ok" && testResult.kind === "rows" && (
            <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-2">
              <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 mb-1">
                <CheckCircle size={12} />
                {t("dashboard.testRunSuccess")} ({testResult.rows.length} rows)
              </div>
              {testResult.rows.length > 0 && (
                <pre className="text-[10px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-all max-h-20 overflow-auto">
                  {JSON.stringify(testResult.rows.slice(0, 3), null, 2)}
                </pre>
              )}
            </div>
          )}
          {testResult?.status === "ok" && testResult.kind === "text" && (
            <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-2">
              <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 mb-1">
                <CheckCircle size={12} />
                {t("dashboard.testRunSuccess")}
              </div>
              <pre className="text-[10px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-all max-h-20 overflow-auto">
                {testResult.text.slice(0, 300)}
              </pre>
            </div>
          )}
          {testResult?.status === "error" && (
            <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-2">
              <div className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
                <AlertCircle size={12} />
                {testResult.error}
              </div>
            </div>
          )}
          {!isText && !testResult && fields.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("dashboard.runToDetectFields")}
            </p>
          )}
        </div>
      </div>

      {/* Output-specific config */}
      {output === "card" && (
        <CardMappingEditor
          card={cfg.card ?? {}}
          cols={cfg.cols}
          fieldNames={fieldNames}
          onChange={(patch: { card?: CardMapping; cols?: number }) => update(patch)}
        />
      )}
      {output === "table" && (
        <ColumnsEditor
          columns={cfg.columns ?? []}
          fieldNames={fieldNames}
          onChange={(columns) => update({ columns })}
        />
      )}
      {isText && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("dashboard.outputStringHint")}
        </p>
      )}

      {/* Filter / sort / limit (card & table only) */}
      {!isText && (
        <>
          <FilterEditor
            filters={cfg.filter ?? []}
            fieldNames={fieldNames}
            fieldTypeMap={fieldTypeMap}
            onChange={(filter) => update({ filter })}
          />
          <SortLimitFields
            sort={cfg.sort}
            limit={cfg.limit}
            sortOptions={sortOptions}
            defaultSort=""
            onChange={update}
          />
        </>
      )}

      {/* Refresh interval */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t("dashboard.refreshInterval")}
        </label>
        <input
          type="number"
          min={0}
          value={cfg.refreshInterval ?? 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            update({ refreshInterval: Number.isFinite(n) && n > 0 ? n : 0 });
          }}
          className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("dashboard.refreshIntervalHint")}
        </p>
      </div>

      {aiDialog && (
        <AIWorkflowDialog
          mode={aiDialog.mode}
          currentYaml={aiDialog.mode === "modify" ? aiDialog.currentYaml : undefined}
          currentName={aiDialog.mode === "modify" ? aiDialog.currentName : undefined}
          workflowId={aiDialog.mode === "modify" ? aiDialog.workflowId : undefined}
          apiPlan={apiPlan}
          encryptedPrivateKey={encryptedPrivateKey}
          salt={salt}
          appendInstructions={formatGuidance}
          onAccept={handleWorkflowAccepted}
          onClose={() => setAiDialog(null)}
        />
      )}
    </div>
  );
}
