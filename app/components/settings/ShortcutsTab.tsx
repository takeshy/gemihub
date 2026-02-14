import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { Plus, Trash2, Keyboard, AlertCircle, Save, Loader2, Check } from "lucide-react";
import type {
  UserSettings,
  ShortcutKeyBinding,
} from "~/types/settings";
import {
  isBuiltinShortcut,
  isValidShortcutKey,
} from "~/types/settings";
import { useI18n } from "~/i18n/context";
import type { TranslationStrings } from "~/i18n/translations";
import { invalidateIndexCache } from "~/routes/_index";

const inputClass =
  "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";

interface WorkflowFile {
  id: string;
  name: string;
}

function formatShortcutDisplay(binding: ShortcutKeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrlOrMeta) parts.push("Ctrl/Cmd");
  if (binding.shift) parts.push("Shift");
  if (binding.alt) parts.push("Alt");
  if (binding.key) parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return parts.join(" + ") || "—";
}

type ValidationError = "duplicate" | "requireModifier" | "builtinConflict";

function getBindingError(
  binding: ShortcutKeyBinding,
  allBindings: ShortcutKeyBinding[],
): ValidationError | null {
  if (!binding.key) return null;
  if (!isValidShortcutKey(binding)) return "requireModifier";
  if (isBuiltinShortcut(binding)) return "builtinConflict";
  // Duplicate check
  for (const other of allBindings) {
    if (other.id === binding.id || !other.key) continue;
    if (
      other.key.toLowerCase() === binding.key.toLowerCase() &&
      other.ctrlOrMeta === binding.ctrlOrMeta &&
      other.shift === binding.shift &&
      other.alt === binding.alt
    ) {
      return "duplicate";
    }
  }
  return null;
}

const ERROR_I18N_KEYS: Record<ValidationError, keyof TranslationStrings> = {
  duplicate: "settings.shortcuts.duplicate",
  requireModifier: "settings.shortcuts.requireModifier",
  builtinConflict: "settings.shortcuts.builtinConflict",
};

// ---------------------------------------------------------------------------
// Per-row save hook
// ---------------------------------------------------------------------------

function useBindingSave() {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const fetcherData = fetcher.data as { success?: boolean; message?: string } | undefined;

  useEffect(() => {
    if (fetcherData?.success) invalidateIndexCache();
  }, [fetcherData]);

  const save = useCallback(
    (bindings: ShortcutKeyBinding[]) => {
      const fd = new FormData();
      fd.set("_action", "saveShortcuts");
      fd.set("shortcutKeys", JSON.stringify(bindings.filter((b) => b.key)));
      fetcher.submit(fd, { method: "post" });
    },
    [fetcher]
  );

  return { save, loading, fetcherData };
}

// ---------------------------------------------------------------------------
// ShortcutsTab
// ---------------------------------------------------------------------------

export function ShortcutsTab({ settings }: { settings: UserSettings }) {
  const { t } = useI18n();

  const [bindings, setBindings] = useState<ShortcutKeyBinding[]>(
    settings.shortcutKeys ?? []
  );
  const { save, loading, fetcherData } = useBindingSave();
  const [listeningId, setListeningId] = useState<string | null>(null);

  // Global key capture: when a binding is in listening mode, capture the key combo
  useEffect(() => {
    if (!listeningId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Ignore modifier-only presses
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      // Escape cancels listening without changing the binding
      if (e.key === "Escape") {
        setListeningId(null);
        return;
      }
      setBindings((prev) =>
        prev.map((b) =>
          b.id === listeningId
            ? { ...b, key: e.key, ctrlOrMeta: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey }
            : b
        )
      );
      setListeningId(null);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [listeningId]);

  // Workflow file list for target picker
  const [workflows, setWorkflows] = useState<WorkflowFile[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/drive/files?action=list");
        if (res.ok) {
          const data = await res.json();
          const yamlFiles = (data.files as WorkflowFile[]).filter(
            (f) => f.name.endsWith(".yaml") || f.name.endsWith(".yml")
          );
          setWorkflows(yamlFiles);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const addBinding = useCallback(() => {
    const id = crypto.randomUUID();
    setBindings((prev) => [
      ...prev,
      {
        id,
        action: "executeWorkflow",
        key: "",
        ctrlOrMeta: false,
        shift: false,
        alt: false,
      },
    ]);
    setListeningId(id);
  }, []);

  const removeBinding = useCallback((id: string) => {
    setBindings((prev) => {
      const next = prev.filter((b) => b.id !== id);
      save(next);
      return next;
    });
    if (listeningId === id) setListeningId(null);
  }, [save, listeningId]);

  const updateBinding = useCallback(
    (id: string, patch: Partial<ShortcutKeyBinding>) => {
      setBindings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
      );
    },
    []
  );

  const saveBinding = useCallback(
    (id: string) => {
      const binding = bindings.find((b) => b.id === id);
      if (!binding || getBindingError(binding, bindings)) return;
      save(bindings);
    },
    [bindings, save]
  );

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      {/* Status banner */}
      {fetcherData && (
        <div className={`mb-6 p-3 rounded-md border text-sm ${
          fetcherData.success
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
        }`}>
          <div className="flex items-center gap-2">
            {fetcherData.success ? <Check size={16} /> : <AlertCircle size={16} />}
            {fetcherData.message}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <Keyboard size={16} />
          {t("settings.tab.shortcuts")}
        </h3>
        <button
          type="button"
          onClick={addBinding}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
        >
          <Plus size={14} />
          {t("settings.shortcuts.addShortcut")}
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t("settings.shortcuts.description")}
      </p>

      {bindings.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
          {t("settings.shortcuts.noShortcuts")}
        </p>
      )}

      <div className="space-y-3">
        {bindings.map((binding) => {
          const error = getBindingError(binding, bindings);
          const isListening = listeningId === binding.id;
          return (
            <div
              key={binding.id}
              className={`border rounded-lg p-4 ${
                error
                  ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="flex items-center gap-2">
                {/* Key combination display / capture */}
                <button
                  type="button"
                  onClick={() => setListeningId(isListening ? null : binding.id)}
                  className={`flex-shrink-0 px-3 py-1.5 text-xs font-mono font-semibold rounded-md border transition-colors cursor-pointer min-w-[80px] text-center ${
                    isListening
                      ? "ring-2 ring-blue-500 border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300"
                      : "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-500"
                  }`}
                >
                  {isListening ? t("settings.shortcuts.pressKey") : formatShortcutDisplay(binding)}
                </button>

                <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">&rarr;</span>

                {/* Target workflow picker */}
                <select
                  value={binding.targetFileId ?? ""}
                  onChange={(e) => {
                    const wf = workflows.find((w) => w.id === e.target.value);
                    updateBinding(binding.id, {
                      targetFileId: wf?.id ?? undefined,
                      targetFileName: wf?.name ?? undefined,
                    });
                  }}
                  className={inputClass + " flex-1 min-w-0"}
                >
                  <option value="">{t("settings.shortcuts.selectWorkflow")}</option>
                  {workflows.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name}
                    </option>
                  ))}
                </select>

                {/* Silent toggle */}
                <label
                  className={`flex-shrink-0 px-2 py-1.5 rounded-md text-xs font-medium select-none border transition-colors cursor-pointer ${
                    binding.silent
                      ? "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                      : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500"
                  }`}
                  title={t("settings.shortcuts.silentDescription")}
                >
                  <input
                    type="checkbox"
                    checked={binding.silent ?? false}
                    onChange={(e) => updateBinding(binding.id, { silent: e.target.checked })}
                    className="sr-only"
                  />
                  {t("settings.shortcuts.silent")}
                </label>

                {/* Save button */}
                <button
                  type="button"
                  disabled={loading || !!error || !binding.key}
                  onClick={() => saveBinding(binding.id)}
                  className="flex-shrink-0 p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Save"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                </button>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => removeBinding(binding.id)}
                  className="flex-shrink-0 p-1.5 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {error && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {t(ERROR_I18N_KEYS[error])}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
