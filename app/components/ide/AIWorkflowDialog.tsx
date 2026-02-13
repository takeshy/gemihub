import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  Brain,
  History,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { ModelType, ApiPlan } from "~/types/settings";
import { getAvailableModels, getDefaultModelForPlan } from "~/types/settings";
import { WorkflowPreviewModal } from "./WorkflowPreviewModal";
import { ExecutionHistorySelectModal } from "./ExecutionHistorySelectModal";
import { useI18n } from "~/i18n/context";
import type { ExecutionStep } from "~/engine/types";

export interface AIWorkflowMeta {
  description: string;
  thinking: string;
  model: string;
  mode: "create" | "modify";
  history: { role: "user" | "model"; text: string }[];
}

interface AIWorkflowDialogProps {
  mode: "create" | "modify";
  currentYaml?: string;
  currentName?: string;
  workflowId?: string;
  apiPlan: ApiPlan;
  encryptedPrivateKey?: string;
  salt?: string;
  onAccept: (yaml: string, name: string, meta: AIWorkflowMeta) => void;
  onClose: () => void;
}

type Phase = "input" | "generating" | "preview";

interface GenerationHistory {
  role: "user" | "model";
  text: string;
}

export function AIWorkflowDialog({
  mode,
  currentYaml,
  currentName,
  workflowId,
  apiPlan,
  encryptedPrivateKey,
  salt,
  onAccept,
  onClose,
}: AIWorkflowDialogProps) {
  const { t } = useI18n();

  // Input state
  const [name, setName] = useState(currentName || "");
  const [description, setDescription] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelType>(getDefaultModelForPlan(apiPlan));

  // Execution history reference
  const [selectedExecutionSteps, setSelectedExecutionSteps] = useState<ExecutionStep[]>([]);
  const [showHistorySelect, setShowHistorySelect] = useState(false);

  // Generation state
  const [phase, setPhase] = useState<Phase>("input");
  const [thinking, setThinking] = useState("");
  const [generatedText, setGeneratedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(false);

  // Regeneration history
  const [history, setHistory] = useState<GenerationHistory[]>([]);
  const [lastDescription, setLastDescription] = useState("");

  // Refs
  const thinkingRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const models = getAvailableModels(apiPlan).filter((m) => !m.isImageModel);

  // Auto-scroll thinking
  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinking]);

  // Focus name input (create) or description input (modify) on mount
  useEffect(() => {
    if (mode === "create") {
      nameRef.current?.focus();
    } else {
      descriptionRef.current?.focus();
    }
  }, [mode]);

  const handleGenerate = useCallback(async () => {
    const desc = description.trim();
    if (!desc) return;
    if (mode === "create" && !name.trim()) return;

    setPhase("generating");
    setThinking("");
    setGeneratedText("");
    setError(null);
    setShowThinking(false);
    setLastDescription(desc);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/workflow/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          name: mode === "create" ? name.trim() : undefined,
          description: desc,
          currentYaml: mode === "modify" ? currentYaml : undefined,
          model: selectedModel,
          history: history.length > 0 ? history : undefined,
          executionSteps: selectedExecutionSteps.length > 0 ? selectedExecutionSteps : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }));
        setError(err.error || "Generation failed");
        setPhase("input");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response stream");
        setPhase("input");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let fullThinking = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (eventType === "thinking" || parsed.type === "thinking") {
                fullThinking += parsed.content || "";
                setThinking(fullThinking);
                if (!showThinking) setShowThinking(true);
              } else if (eventType === "text" || parsed.type === "text") {
                fullText += parsed.content || "";
                setGeneratedText(fullText);
              } else if (eventType === "error" || parsed.type === "error") {
                setError(parsed.content || "Generation error");
                setPhase("input");
                return;
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }

      // Extract YAML from code block if present
      let yaml = fullText;
      const codeBlockMatch = yaml.match(/```(?:yaml)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        yaml = codeBlockMatch[1].trim();
      }

      if (!yaml.trim()) {
        setError("AI returned empty response. Please try again.");
        setPhase("input");
        return;
      }

      setGeneratedText(yaml);
      // Update history for potential regeneration
      setHistory((prev) => [
        ...prev,
        { role: "user", text: desc },
        { role: "model", text: yaml },
      ]);
      setPhase("preview");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Generation failed");
      setPhase("input");
    }
  }, [description, name, mode, currentYaml, selectedModel, history, showThinking, selectedExecutionSteps]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase("input");
  }, []);

  const handleAcceptPreview = useCallback(() => {
    const workflowName = mode === "create" ? name.trim() : (currentName || "workflow");
    onAccept(generatedText, workflowName, {
      description: lastDescription,
      thinking,
      model: selectedModel,
      mode,
      history,
    });
  }, [generatedText, name, currentName, mode, onAccept, lastDescription, thinking, selectedModel, history]);

  const handleRejectPreview = useCallback(() => {
    // Go back to input for refinement, keep history
    setDescription("");
    setPhase("input");
    setTimeout(() => descriptionRef.current?.focus(), 100);
  }, []);

  // Preview phase
  if (phase === "preview") {
    return (
      <WorkflowPreviewModal
        yaml={generatedText}
        originalYaml={mode === "modify" ? currentYaml : undefined}
        mode={mode}
        workflowName={mode === "create" ? name : currentName}
        onAccept={handleAcceptPreview}
        onReject={handleRejectPreview}
        onClose={onClose}
      />
    );
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={ICON.LG} className="text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {mode === "create" ? "Create Workflow with AI" : "Modify Workflow with AI"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Name (create mode only) */}
          {mode === "create" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Workflow Name
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., process-notes"
                disabled={phase === "generating"}
                className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 disabled:opacity-50"
              />
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {history.length > 0
                ? "Additional request (refine the result)"
                : mode === "create"
                  ? "Describe what this workflow should do"
                  : "Describe how to modify this workflow"}
            </label>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                history.length > 0
                  ? "e.g., Change the loop to process only .md files..."
                  : mode === "create"
                    ? "e.g., Read all markdown files from Drive, summarize each one using AI, and save the summaries to a new file..."
                    : "e.g., Add error handling to the HTTP request node..."
              }
              rows={4}
              disabled={phase === "generating"}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 disabled:opacity-50 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
          </div>

          {/* Execution History Reference (modify mode only) */}
          {mode === "modify" && workflowId && (
            <div>
              <button
                onClick={() => setShowHistorySelect(true)}
                disabled={phase === "generating"}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
              >
                <History size={ICON.SM} />
                {t("workflow.referenceHistory")}
              </button>
              {selectedExecutionSteps.length > 0 && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {t("workflow.historySelect.stepsSelected").replace(
                      "{count}",
                      String(selectedExecutionSteps.length)
                    )}
                  </span>
                  <button
                    onClick={() => setSelectedExecutionSteps([])}
                    className="text-[10px] text-red-500 hover:text-red-700"
                  >
                    &times;
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Model selector */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Model
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as ModelType)}
              disabled={phase === "generating"}
              className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 disabled:opacity-50"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Generation progress */}
          {phase === "generating" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 size={ICON.SM} className="animate-spin" />
                <span>Generating workflow...</span>
              </div>

              {/* Thinking section */}
              {thinking && (
                <div>
                  <button
                    onClick={() => setShowThinking(!showThinking)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  >
                    {showThinking ? <ChevronDown size={ICON.SM} /> : <ChevronRight size={ICON.SM} />}
                    <Brain size={ICON.SM} />
                    Thinking...
                  </button>
                  {showThinking && (
                    <div
                      ref={thinkingRef}
                      className="mt-1 max-h-32 overflow-y-auto rounded bg-gray-50 p-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-mono whitespace-pre-wrap"
                    >
                      {thinking}
                    </div>
                  )}
                </div>
              )}

              {/* Streaming text preview */}
              {generatedText && (
                <div className="max-h-24 overflow-y-auto rounded bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300 font-mono whitespace-pre-wrap">
                  {generatedText.slice(0, 300)}
                  {generatedText.length > 300 && "..."}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="text-[10px] text-gray-400">
            {phase === "input" && "Ctrl+Enter to generate"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            {phase === "generating" ? (
              <button
                onClick={handleCancel}
                className="rounded bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={
                  !description.trim() || (mode === "create" && !name.trim())
                }
                className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                <Sparkles size={ICON.SM} />
                {history.length > 0 ? "Regenerate" : "Generate"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    {showHistorySelect && workflowId && (
      <ExecutionHistorySelectModal
        workflowId={workflowId}
        encryptedPrivateKey={encryptedPrivateKey}
        salt={salt}
        onSelect={(steps) => {
          setSelectedExecutionSteps(steps);
          setShowHistorySelect(false);
        }}
        onClose={() => setShowHistorySelect(false)}
      />
    )}
    </>
  );
}
