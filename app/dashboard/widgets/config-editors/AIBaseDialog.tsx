// AI editing dialog for the Base widget — mirrors the workflow widget's
// "edit with AI" modal feel: describe the change, generate, preview the
// resulting .base YAML, then apply. Backed by /api/base/ai-generate (the
// endpoint feeds the model the full Bases skill spec).

import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, X, Loader2, Check, ArrowLeft } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";

type Phase = "input" | "generating" | "preview";

export function AIBaseDialog({
  currentYaml,
  fileName,
  onApply,
  onClose,
}: {
  currentYaml: string;
  fileName: string;
  onApply: (yaml: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("input");
  const [instruction, setInstruction] = useState("");
  const [generated, setGenerated] = useState("");
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  const generate = useCallback(async () => {
    const desc = instruction.trim();
    if (!desc) return;
    setPhase("generating");
    setError(null);
    try {
      const res = await fetch("/api/base/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: desc, currentYaml, fileName }),
      });
      const data = (await res.json()) as { yaml?: string; error?: string };
      if (!res.ok || !data.yaml) {
        throw new Error(data.error || t("dashboard.baseAiFailed"));
      }
      setGenerated(data.yaml);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("input");
    }
  }, [instruction, currentYaml, fileName, t]);

  const apply = useCallback(async () => {
    try {
      await onApply(generated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("preview");
    }
  }, [generated, onApply, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-4 md:items-center md:pt-0">
      <div className="mx-4 flex w-full max-w-lg flex-col rounded-lg bg-white shadow-xl dark:bg-gray-900" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={ICON.LG} className="text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("dashboard.baseAiTitle")}
            </h3>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={ICON.LG} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="truncate font-medium">{fileName}</span>
          </div>

          {phase === "preview" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("dashboard.baseAiPreview")}
              </label>
              <pre className="max-h-[50vh] overflow-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 whitespace-pre-wrap">
                {generated}
              </pre>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("dashboard.baseAiRequest")}
              </label>
              <textarea
                ref={promptRef}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={t("dashboard.baseAiPlaceholder")}
                rows={5}
                disabled={phase === "generating"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void generate();
                  }
                }}
                className="w-full resize-none rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 disabled:opacity-50"
              />
            </div>
          )}

          {phase === "generating" && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 size={ICON.SM} className="animate-spin" />
              {t("dashboard.baseAiGenerating")}
            </div>
          )}

          {error && (
            <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="text-[10px] text-gray-400">
            {phase === "input" && t("dashboard.baseAiCtrlEnter")}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
              {t("dashboard.cancel")}
            </button>
            {phase === "preview" ? (
              <>
                <button
                  onClick={() => setPhase("input")}
                  className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <ArrowLeft size={ICON.SM} />
                  {t("dashboard.baseAiBack")}
                </button>
                <button
                  onClick={apply}
                  className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
                >
                  <Check size={ICON.SM} />
                  {t("dashboard.baseAiApply")}
                </button>
              </>
            ) : (
              <button
                onClick={generate}
                disabled={!instruction.trim() || phase === "generating"}
                className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                <Sparkles size={ICON.SM} />
                {t("dashboard.baseAiGenerate")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
