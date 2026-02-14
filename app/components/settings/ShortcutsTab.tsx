import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { Plus, Trash2, Keyboard, AlertCircle, Save, Loader2, Check } from "lucide-react";
import type {
  UserSettings,
  ShortcutKeyBinding,
  ShortcutAction,
} from "~/types/settings";
import {
  SHORTCUT_ACTIONS,
  isBuiltinShortcut,
  isValidShortcutKey,
} from "~/types/settings";
import { useI18n } from "~/i18n/context";
import type { TranslationStrings } from "~/i18n/translations";
import { invalidateIndexCache } from "~/routes/_index";

const inputClass =
  "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";
const checkboxClass =
  "h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500";

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
// Key capture input
// ---------------------------------------------------------------------------

function ShortcutKeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (key: string) => void;
  placeholder: string;
}) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Ignore modifier-only presses
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      onChange(e.key);
      setListening(false);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [listening, onChange]);

  return (
    <input
      type="text"
      readOnly
      value={listening ? "" : (value.length === 1 ? value.toUpperCase() : value)}
      placeholder={listening ? placeholder : "—"}
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
      className={`${inputClass} cursor-pointer text-center w-32 ${listening ? "ring-2 ring-blue-500" : ""}`}
    />
  );
}

// ---------------------------------------------------------------------------
// ShortcutsTab
// ---------------------------------------------------------------------------

export function ShortcutsTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t } = useI18n();

  const fetcherData = fetcher.data as { success?: boolean; message?: string } | undefined;
  useEffect(() => {
    if (fetcherData?.success) invalidateIndexCache();
  }, [fetcherData]);

  const [bindings, setBindings] = useState<ShortcutKeyBinding[]>(
    settings.shortcutKeys ?? []
  );

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
    setBindings((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        action: "executeWorkflow",
        key: "",
        ctrlOrMeta: false,
        shift: false,
        alt: false,
      },
    ]);
  }, []);

  const removeBinding = useCallback((id: string) => {
    setBindings((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const updateBinding = useCallback(
    (id: string, patch: Partial<ShortcutKeyBinding>) => {
      setBindings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
      );
    },
    []
  );

  const hasErrors = bindings.some((b) => getBindingError(b, bindings) !== null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (hasErrors) return;
      const fd = new FormData();
      fd.set("_action", "saveShortcuts");
      fd.set("shortcutKeys", JSON.stringify(bindings.filter((b) => b.key)));
      fetcher.submit(fd, { method: "post" });
    },
    [bindings, hasErrors, fetcher]
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

      <form onSubmit={handleSubmit}>
        <div className="flex items-center justify-between mb-4">
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

        {bindings.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
            {t("settings.shortcuts.noShortcuts")}
          </p>
        )}

        <div className="space-y-3">
          {bindings.map((binding) => {
            const error = getBindingError(binding, bindings);
            return (
              <div
                key={binding.id}
                className={`border rounded-lg p-4 ${
                  error
                    ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {/* Action select */}
                  <div className="flex-shrink-0">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {t("settings.shortcuts.action")}
                    </label>
                    <select
                      value={binding.action}
                      onChange={(e) =>
                        updateBinding(binding.id, { action: e.target.value as ShortcutAction })
                      }
                      className={inputClass + " w-48"}
                    >
                      {SHORTCUT_ACTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {t(a.labelKey as keyof TranslationStrings)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Target workflow picker (for executeWorkflow) */}
                  {binding.action === "executeWorkflow" && (
                    <div className="flex-shrink-0">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                        {t("settings.shortcuts.targetWorkflow")}
                      </label>
                      <select
                        value={binding.targetFileId ?? ""}
                        onChange={(e) => {
                          const wf = workflows.find((w) => w.id === e.target.value);
                          updateBinding(binding.id, {
                            targetFileId: wf?.id ?? undefined,
                            targetFileName: wf?.name ?? undefined,
                          });
                        }}
                        className={inputClass + " w-48"}
                      >
                        <option value="">{t("settings.shortcuts.selectWorkflow")}</option>
                        {workflows.map((wf) => (
                          <option key={wf.id} value={wf.id}>
                            {wf.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Modifier checkboxes */}
                  <div className="flex items-end gap-4">
                    <label className="flex flex-col items-center gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t("settings.shortcuts.ctrlOrMeta")}
                      </span>
                      <input
                        type="checkbox"
                        checked={binding.ctrlOrMeta}
                        onChange={(e) =>
                          updateBinding(binding.id, { ctrlOrMeta: e.target.checked })
                        }
                        className={checkboxClass}
                      />
                    </label>
                    <label className="flex flex-col items-center gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t("settings.shortcuts.shift")}
                      </span>
                      <input
                        type="checkbox"
                        checked={binding.shift}
                        onChange={(e) =>
                          updateBinding(binding.id, { shift: e.target.checked })
                        }
                        className={checkboxClass}
                      />
                    </label>
                    <label className="flex flex-col items-center gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t("settings.shortcuts.alt")}
                      </span>
                      <input
                        type="checkbox"
                        checked={binding.alt}
                        onChange={(e) =>
                          updateBinding(binding.id, { alt: e.target.checked })
                        }
                        className={checkboxClass}
                      />
                    </label>
                  </div>

                  {/* Key input */}
                  <div className="flex-shrink-0">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {t("settings.shortcuts.key")}
                    </label>
                    <ShortcutKeyInput
                      value={binding.key}
                      onChange={(key) => updateBinding(binding.id, { key })}
                      placeholder={t("settings.shortcuts.pressKey")}
                    />
                  </div>

                  {/* Preview */}
                  <div className="flex-shrink-0 flex items-end pb-0.5">
                    <kbd className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded">
                      {formatShortcutDisplay(binding)}
                    </kbd>
                  </div>

                  {/* Delete button */}
                  <div className="flex-shrink-0 flex items-end ml-auto">
                    <button
                      type="button"
                      onClick={() => removeBinding(binding.id)}
                      className="p-1.5 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
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

        <div className="mt-6">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
