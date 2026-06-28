import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, Sparkles, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { ModelInfo, ModelType } from "~/types/settings";
import { ICON } from "~/utils/icon-sizes";

type Phase = "input" | "generating" | "preview";

interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: ModelType;
}

interface RewriteResponse {
  content?: string;
  error?: string;
}

export function TimelineAiRewriteDialog({
  content,
  onApply,
  onClose,
}: {
  content: string;
  onApply: (content: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("input");
  const [instruction, setInstruction] = useState("");
  const [generated, setGenerated] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelType | "">("");
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const canGenerate = useMemo(() => !!instruction.trim() && !!selectedModel && phase !== "generating", [instruction, selectedModel, phase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/timeline/ai-rewrite");
        const data = (await res.json()) as ModelsResponse;
        if (cancelled) return;
        setModels(data.models ?? []);
        setSelectedModel(data.defaultModel ?? data.models?.[0]?.name ?? "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    promptRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = useCallback(async () => {
    const desc = instruction.trim();
    if (!desc || !selectedModel) return;
    setPhase("generating");
    setError(null);
    try {
      const res = await fetch("/api/timeline/ai-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, instruction: desc, model: selectedModel }),
      });
      const data = (await res.json()) as RewriteResponse;
      if (!res.ok || !data.content) {
        throw new Error(data.error || t("dashboard.timelineAiFailed"));
      }
      setGenerated(data.content);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("input");
    }
  }, [content, instruction, selectedModel, t]);

  const apply = useCallback(() => {
    onApply(generated);
    onClose();
  }, [generated, onApply, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-4 md:items-center md:pt-0">
      <div className="mx-4 flex w-full max-w-lg flex-col rounded-lg bg-white shadow-xl dark:bg-gray-900" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={ICON.LG} className="text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("dashboard.timelineAiEdit")}
            </h3>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={ICON.LG} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {phase === "preview" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("dashboard.timelineAiPreview")}
              </label>
              <textarea
                value={generated}
                onChange={(e) => setGenerated(e.target.value)}
                rows={10}
                className="w-full resize-y rounded border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("dashboard.timelineAiInstruction")}
                </label>
                <textarea
                  ref={promptRef}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={t("dashboard.timelineAiInstructionPlaceholder")}
                  rows={4}
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

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("workflow.ai.model")}
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value as ModelType)}
                  disabled={phase === "generating" || models.length === 0}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 disabled:opacity-50"
                >
                  {models.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {phase === "generating" && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 size={ICON.SM} className="animate-spin" />
              {t("dashboard.timelineAiGenerating")}
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
            {phase === "input" && t("dashboard.timelineAiCtrlEnter")}
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
                  disabled={!generated.trim()}
                  className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  <Check size={ICON.SM} />
                  {t("dashboard.baseAiApply")}
                </button>
              </>
            ) : (
              <button
                onClick={generate}
                disabled={!canGenerate}
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
