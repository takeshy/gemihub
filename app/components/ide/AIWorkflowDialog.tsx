import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  Brain,
  History,
  Copy,
  Check,
  ClipboardPaste,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { ModelType, ApiPlan } from "~/types/settings";
import { getAvailableModels, getDefaultModelForPlan } from "~/types/settings";
import { WorkflowPreviewModal } from "./WorkflowPreviewModal";
import { ExecutionHistorySelectModal } from "./ExecutionHistorySelectModal";
import { useI18n } from "~/i18n/context";
import { useSkills } from "~/contexts/SkillContext";
import type { ExecutionStep } from "~/engine/types";
import { fixMarkdownBullets } from "~/utils/yaml-helpers";

/** Extract YAML content from a fenced code block, or return text as-is. */
function extractYamlFromCodeBlock(text: string): string {
  const m = text.match(/```(?:yaml)?\s*([\s\S]*?)```/);
  const raw = m ? m[1].trim() : text;
  return fixMarkdownBullets(raw);
}

/** Extract both SKILL.md and workflow YAML from AI response.
 *  Uses ===WORKFLOW=== delimiter to split the two parts.
 */
function extractSkillAndYaml(text: string): { skillMd: string | null; yaml: string } {
  const delimIdx = text.indexOf("===WORKFLOW===");
  if (delimIdx !== -1) {
    const skillPart = fixMarkdownBullets(text.slice(0, delimIdx).trim());
    let yamlPart = text.slice(delimIdx + "===WORKFLOW===".length).trim();
    // Strip code fences if LLM wrapped the YAML part
    yamlPart = extractYamlFromCodeBlock(yamlPart) || yamlPart;
    if (skillPart && yamlPart) {
      return { skillMd: skillPart, yaml: yamlPart };
    }
  }
  return { skillMd: null, yaml: extractYamlFromCodeBlock(text) };
}

export interface AIWorkflowMeta {
  description: string;
  thinking: string;
  model: string;
  mode: "create" | "modify";
  history: { role: "user" | "model"; text: string }[];
  /** When set, create the workflow under this folder path instead of "workflows/" */
  skillFolderPath?: string;
  /** Generated SKILL.md content to create alongside the workflow */
  skillMdContent?: string;
  /** Folder name for a new skill (e.g., "code-review") */
  newSkillId?: string;
}

interface AIWorkflowDialogProps {
  mode: "create" | "modify";
  currentYaml?: string;
  currentName?: string;
  workflowId?: string;
  apiPlan: ApiPlan;
  encryptedPrivateKey?: string;
  salt?: string;
  onAccept: (yaml: string, name: string, meta: AIWorkflowMeta) => void | Promise<void>;
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
  const { skills, skillsFolderName } = useSkills();

  // Input state
  const [name, setName] = useState(currentName || "");
  const [createAsSkill, setCreateAsSkill] = useState(false);
  const [description, setDescription] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelType>(getDefaultModelForPlan(apiPlan));

  // Execution history reference
  const [selectedExecutionSteps, setSelectedExecutionSteps] = useState<ExecutionStep[]>([]);
  const [showHistorySelect, setShowHistorySelect] = useState(false);

  // Generation state
  const [phase, setPhase] = useState<Phase>("input");
  const [thinking, setThinking] = useState("");
  const [generatedText, setGeneratedText] = useState("");
  const [generatedSkillMd, setGeneratedSkillMd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(false);

  // Regeneration history
  const [history, setHistory] = useState<GenerationHistory[]>([]);
  const [lastDescription, setLastDescription] = useState("");

  // External LLM paste flow
  const [showPasteSection, setShowPasteSection] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);

  // Refs
  const thinkingRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const models = getAvailableModels(apiPlan).filter((m) => !m.isImageModel);

  // Skill mode: derive folder name from name input
  const isSkillMode = mode === "create" && createAsSkill;
  const skillFolderId = useMemo(
    () => isSkillMode
      ? name.trim().replace(/[\s/\\]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
      : "",
    [isSkillMode, name]
  );
  const canSubmit = description.trim() && (mode !== "create" || name.trim());

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
    setGeneratedSkillMd("");
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
          skillMode: isSkillMode || undefined,
          skillFolderName: isSkillMode ? skillFolderId : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("workflow.ai.generationFailed") }));
        setError(err.error || t("workflow.ai.generationFailed"));
        setPhase("input");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError(t("workflow.ai.noResponseStream"));
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
                setShowThinking(true);
              } else if (eventType === "text" || parsed.type === "text") {
                fullText += parsed.content || "";
                setGeneratedText(fullText);
              } else if (eventType === "error" || parsed.type === "error") {
                setError(parsed.content || t("workflow.ai.generationError"));
                setPhase("input");
                return;
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }

      // Extract YAML (and optionally SKILL.md) from code blocks
      const { skillMd, yaml } = extractSkillAndYaml(fullText);

      if (!yaml.trim()) {
        setError(t("workflow.ai.emptyResponse"));
        setPhase("input");
        return;
      }

      setGeneratedText(yaml);
      if (skillMd) setGeneratedSkillMd(skillMd);
      // Update history for potential regeneration (include full response for context)
      setHistory((prev) => [
        ...prev,
        { role: "user", text: desc },
        { role: "model", text: yaml },
      ]);
      setPhase("preview");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : t("workflow.ai.generationFailed"));
      setPhase("input");
    }
  }, [description, name, mode, currentYaml, selectedModel, history, selectedExecutionSteps, t, isSkillMode, skillFolderId]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase("input");
  }, []);

  const handleAcceptPreview = useCallback(async () => {
    const workflowName = mode === "create" ? name.trim() : (currentName || "workflow");
    const skillFolderPath = isSkillMode && skillFolderId
      ? `${skillsFolderName}/${skillFolderId}/workflows`
      : undefined;
    await onAccept(generatedText, workflowName, {
      description: lastDescription,
      thinking,
      model: selectedModel,
      mode,
      history,
      skillFolderPath,
      skillMdContent: isSkillMode ? (generatedSkillMd || undefined) : undefined,
      newSkillId: isSkillMode && skillFolderId ? skillFolderId : undefined,
    });
  }, [generatedText, generatedSkillMd, name, currentName, mode, onAccept, lastDescription, thinking, selectedModel, history, isSkillMode, skillFolderId, skillsFolderName]);

  const handleRejectPreview = useCallback(() => {
    // Go back to input for refinement, keep history
    setDescription("");
    setGeneratedSkillMd("");
    setPhase("input");
    setTimeout(() => descriptionRef.current?.focus(), 100);
  }, []);

  const handleCopyPrompt = useCallback(async () => {
    const desc = description.trim();
    if (!desc) return;
    if (mode === "create" && !name.trim()) return;

    setError(null);

    try {
      const res = await fetch("/api/workflow/ai-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          name: mode === "create" ? name.trim() : undefined,
          description: desc,
          currentYaml: mode === "modify" ? currentYaml : undefined,
          executionSteps: selectedExecutionSteps.length > 0 ? selectedExecutionSteps : undefined,
          skillMode: isSkillMode || undefined,
          skillFolderName: isSkillMode ? skillFolderId : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("workflow.ai.generationFailed") }));
        setError(err.error || t("workflow.ai.generationFailed"));
        return;
      }

      const data = await res.json();
      await navigator.clipboard.writeText(data.prompt);
      setLastDescription(desc);
      setShowPasteSection(true);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("workflow.ai.generationFailed"));
    }
  }, [description, name, mode, currentYaml, selectedExecutionSteps, t, isSkillMode, skillFolderId]);

  const handleApplyPasted = useCallback(async () => {
    const text = pastedText.trim();
    if (!text) {
      setError(t("workflow.ai.enterPastedYaml"));
      return;
    }

    // Try to extract SKILL.md and YAML from code blocks
    const { skillMd, yaml } = extractSkillAndYaml(text);

    // Validate that it looks like workflow YAML
    if (!yaml.includes("name:") || !yaml.includes("nodes:")) {
      setError(t("workflow.ai.parseFailed"));
      return;
    }

    setError(null);
    setGeneratedText(yaml);
    setGeneratedSkillMd(skillMd || "");
    setHistory((prev) => [
      ...prev,
      { role: "user", text: lastDescription },
      { role: "model", text: text },
    ]);
    setPhase("preview");
  }, [pastedText, lastDescription, t]);

  // Preview phase
  if (phase === "preview") {
    return (
      <WorkflowPreviewModal
        yaml={generatedText}
        originalYaml={mode === "modify" ? currentYaml : undefined}
        mode={mode}
        workflowName={mode === "create" ? name : currentName}
        skillMd={generatedSkillMd || undefined}
        onAccept={handleAcceptPreview}
        onReject={handleRejectPreview}
        onClose={onClose}
      />
    );
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={ICON.LG} className="text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {mode === "create" ? t("workflow.ai.createTitle") : t("workflow.ai.modifyTitle")}
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
          {/* Name + skill checkbox (create mode only) */}
          {mode === "create" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {createAsSkill ? t("workflow.ai.skillName") : t("workflow.ai.workflowName")}
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={createAsSkill ? t("workflow.ai.skillNamePlaceholder") : t("workflow.ai.namePlaceholder")}
                disabled={phase === "generating"}
                className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 disabled:opacity-50"
              />
              {createAsSkill && skillFolderId && (
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                  {skillsFolderName}/{skillFolderId}/
                </p>
              )}
              <label className="mt-2 flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createAsSkill}
                  onChange={(e) => setCreateAsSkill(e.target.checked)}
                  disabled={phase === "generating"}
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600"
                />
                {t("workflow.ai.createAsSkill")}
              </label>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {history.length > 0
                ? t("workflow.ai.refineLabel")
                : mode === "create"
                  ? t("workflow.ai.createLabel")
                  : t("workflow.ai.modifyLabel")}
            </label>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                history.length > 0
                  ? t("workflow.ai.refinePlaceholder")
                  : mode === "create"
                    ? t("workflow.ai.createPlaceholder")
                    : t("workflow.ai.modifyPlaceholder")
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
              {t("workflow.ai.model")}
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
                <span>{t("workflow.ai.generating")}</span>
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
                    {t("workflow.ai.thinking")}
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
            {phase === "input" && t("workflow.ai.ctrlEnter")}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {t("workflow.ai.cancel")}
            </button>
            {phase === "generating" ? (
              <button
                onClick={handleCancel}
                className="rounded bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
              >
                {t("workflow.ai.stop")}
              </button>
            ) : (
              <>
                <button
                  onClick={handleCopyPrompt}
                  disabled={!canSubmit}
                  className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                    promptCopied
                      ? "border-green-300 text-green-700 dark:border-green-600 dark:text-green-300"
                      : "border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  {promptCopied ? <Check size={ICON.SM} /> : <Copy size={ICON.SM} />}
                  {promptCopied ? t("workflow.ai.promptCopied") : t("workflow.ai.copyPrompt")}
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!canSubmit}
                  className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  <Sparkles size={ICON.SM} />
                  {history.length > 0 ? t("workflow.ai.regenerate") : t("workflow.ai.generate")}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Paste response section (for external LLM flow) — below footer like obsidian-gemini-helper */}
        {showPasteSection && phase === "input" && (
          <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700 space-y-2">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("workflow.ai.pasteLabel")}
            </label>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder={t("workflow.ai.pastePlaceholder")}
              rows={6}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 resize-none font-mono text-xs"
            />
            <div className="flex justify-end">
              <button
                onClick={handleApplyPasted}
                disabled={!pastedText.trim()}
                className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <ClipboardPaste size={ICON.SM} />
                {t("workflow.ai.applyPasted")}
              </button>
            </div>
          </div>
        )}
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
