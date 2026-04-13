import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { parseWorkflowYaml } from "~/engine/parser";
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
  AlertTriangle,
  AlertCircle,
  Info,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { ModelType, ApiPlan } from "~/types/settings";
import { getAvailableModels, getDefaultModelForPlan, SKILLS_FOLDER_NAME } from "~/types/settings";
import { WorkflowPreviewModal } from "./WorkflowPreviewModal";
import { ExecutionHistorySelectModal } from "./ExecutionHistorySelectModal";
import { useI18n } from "~/i18n/context";
import type { ExecutionStep } from "~/engine/types";
import { fixMarkdownBullets } from "~/utils/yaml-helpers";
import {
  parseReviewResponse,
  type ReviewResult,
  type GenerationContext,
} from "~/services/ai-workflow-generation";
import type { TranslationStrings } from "~/i18n/translations";

type TFn = (key: keyof TranslationStrings) => string;

/** Extract YAML content from a fenced code block, or return text as-is. */
function extractYamlFromCodeBlock(text: string): string {
  const m = text.match(/```(?:yaml)?\s*([\s\S]*?)```/);
  const raw = m ? m[1].trim() : text;
  return fixMarkdownBullets(raw);
}

/**
 * Validate that the extracted YAML can be parsed into a Workflow. Returns a
 * human-readable error message describing the failure, or null on success.
 * Used to drive the auto-repair loop when the LLM emits broken YAML.
 */
function validateGeneratedYaml(yaml: string): string | null {
  if (!yaml.trim()) {
    return "No workflow YAML found. The response must contain a YAML block starting with 'name:' and including 'nodes:'.";
  }
  try {
    const workflow = parseWorkflowYaml(yaml);
    if (workflow.nodes.size === 0) {
      return "Parsed YAML has no 'nodes' defined.";
    }
    return null;
  } catch (err) {
    return `YAML syntax error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Build a repair prompt for the LLM: it carries the specific parse error and
 * the previous broken output so the model can self-correct without losing context.
 */
function buildRepairUserPrompt(parseError: string, previousResponse: string): string {
  return `Your previous output could not be parsed into a valid workflow.

PARSE ERROR:
${parseError}

YOUR PREVIOUS OUTPUT:
${previousResponse}

Fix the problem and output ONLY the complete, valid YAML workflow starting with "name:". Do not include any prose, explanation, or commentary — just the YAML.`;
}

/** Extract both SKILL.md and workflow YAML from AI response.
 *  Uses ===WORKFLOW=== delimiter to split the two parts.
 */
function extractSkillAndYaml(text: string): { skillMd: string | null; yaml: string } {
  const delimIdx = text.indexOf("===WORKFLOW===");
  if (delimIdx !== -1) {
    const skillPart = fixMarkdownBullets(text.slice(0, delimIdx).trim());
    let yamlPart = text.slice(delimIdx + "===WORKFLOW===".length).trim();
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
  /** Generation-phase context shown in the preview for transparency. */
  generationContext?: GenerationContext;
}

interface AIWorkflowDialogProps {
  mode: "create" | "modify";
  currentYaml?: string;
  currentName?: string;
  workflowId?: string;
  apiPlan: ApiPlan;
  encryptedPrivateKey?: string;
  salt?: string;
  /** When true, lock this session to skill creation/modification. */
  forceSkill?: boolean;
  /** Existing skill instructions body (used with forceSkill + mode=modify). */
  existingInstructions?: string;
  /** Path of the skill's workflow file relative to the skill folder
   *  (e.g., "workflows/run-lint.yaml") — used by Modify Skill with AI to
   *  preserve the real frontmatter workflow reference. */
  workflowFilePath?: string;
  onAccept: (yaml: string, name: string, meta: AIWorkflowMeta) => void | Promise<void>;
  onClose: () => void;
}

type Phase =
  | "input"
  | "planning"
  | "planReady"
  | "generating"
  | "reviewing"
  | "reviewReady"
  | "refining"
  | "preview";

interface GenerationHistory {
  role: "user" | "model";
  text: string;
}

interface StreamResult {
  fullText: string;
  fullThinking: string;
}

export function AIWorkflowDialog({
  mode,
  currentYaml,
  currentName,
  workflowId,
  apiPlan,
  encryptedPrivateKey,
  salt,
  forceSkill = false,
  existingInstructions,
  workflowFilePath,
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
  const [generatedSkillMd, setGeneratedSkillMd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(false);

  // Plan / review state
  const [planText, setPlanText] = useState("");
  const [planFeedback, setPlanFeedback] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [parsedReview, setParsedReview] = useState<ReviewResult | undefined>();
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [reviewIteration, setReviewIteration] = useState(0);

  // Parse-failure state: shown when auto-repair exhausts retries without
  // producing a parseable workflow YAML. Keeps the dialog open so the user
  // can copy the raw response into a stronger LLM.
  const [parseFailure, setParseFailure] = useState<{ response: string; error: string } | null>(null);

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
  const pasteSectionRef = useRef<HTMLDivElement>(null);
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const models = getAvailableModels(apiPlan).filter((m) => !m.isImageModel);

  // Skill mode: locked (skill flows) or determined by checkbox (legacy) — we removed
  // the checkbox in favor of dedicated "Create skill with AI" entry points.
  const isSkillMode = forceSkill;
  const skillFolderId = useMemo(
    () => isSkillMode
      ? name.trim().replace(/[\s/\\]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
      : "",
    [isSkillMode, name]
  );
  const canSubmit = description.trim() && (mode !== "create" || name.trim());

  const isWorking =
    phase === "planning" ||
    phase === "generating" ||
    phase === "reviewing" ||
    phase === "refining";

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

  // ── Stream a single phase via SSE; returns accumulated text + thinking ──
  const streamPhase = useCallback(
    async (
      body: Record<string, unknown>,
      onText: (chunk: string) => void,
      onThinking: (chunk: string) => void,
      signal: AbortSignal,
    ): Promise<StreamResult> => {
      const res = await fetch("/api/workflow/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("workflow.ai.generationFailed") }));
        throw new Error(err.error || t("workflow.ai.generationFailed"));
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error(t("workflow.ai.noResponseStream"));

      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let fullThinking = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
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
                const c = parsed.content || "";
                fullThinking += c;
                onThinking(c);
              } else if (eventType === "text" || parsed.type === "text") {
                const c = parsed.content || "";
                fullText += c;
                onText(c);
              } else if (eventType === "error" || parsed.type === "error") {
                throw new Error(parsed.content || t("workflow.ai.generationError"));
              }
            } catch (e) {
              if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
            }
          }
        }
      }
      return { fullText, fullThinking };
    },
    [t],
  );

  // ── Full generation pipeline: plan? → generate → review → (refine loop) → preview ──
  const runPipeline = useCallback(
    async (desc: string, planOverride?: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setThinking("");
      setShowThinking(false);
      setGeneratedText("");
      setGeneratedSkillMd("");
      setReviewText("");
      setParsedReview(undefined);
      // Reset per-iteration UI state so stale input doesn't leak between runs.
      setPlanFeedback("");
      setReviewFeedback("");
      setReviewIteration(0);
      setParseFailure(null);

      // Plan only on the first creation attempt — skip on modify and on subsequent refinements.
      const shouldPlan = mode === "create" && history.length === 0 && !planOverride;

      const commonBody: Record<string, unknown> = {
        mode,
        name: mode === "create" ? name.trim() : undefined,
        description: desc,
        currentYaml: mode === "modify" ? currentYaml : undefined,
        existingInstructions: mode === "modify" && isSkillMode ? existingInstructions : undefined,
        workflowFilePath: mode === "modify" && isSkillMode ? workflowFilePath : undefined,
        model: selectedModel,
        history: history.length > 0 ? history : undefined,
        executionSteps: selectedExecutionSteps.length > 0 ? selectedExecutionSteps : undefined,
        skillMode: isSkillMode || undefined,
        skillFolderName: isSkillMode && skillFolderId ? skillFolderId : undefined,
      };

      try {
        // ── PHASE 1: PLAN ────────────────────────────────────────────────
        let activePlan = planOverride || "";
        if (shouldPlan) {
          setPhase("planning");
          setPlanText("");
          const { fullText, fullThinking } = await streamPhase(
            { ...commonBody, phase: "plan" },
            (c) => setPlanText((p) => p + c),
            (c) => {
              setThinking((p) => p + c);
              if (c) setShowThinking(true);
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          activePlan = fullText;
          setPlanText(fullText);
          void fullThinking;
          // Pause for user review — they pick OK / Re-plan / Cancel.
          setPhase("planReady");
          return;
        }

        // ── PHASE 2: GENERATE (+ auto-repair on invalid YAML) ───────────
        setPhase("generating");
        const genResult = await streamPhase(
          { ...commonBody, phase: "generate", plan: activePlan || undefined },
          (c) => setGeneratedText((p) => p + c),
          (c) => {
            setThinking((p) => p + c);
            if (c) setShowThinking(true);
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;

        let rawResponse = genResult.fullText;
        let extracted = extractSkillAndYaml(rawResponse);
        let parseError = validateGeneratedYaml(extracted.yaml);

        // Re-prompt the LLM up to twice on parse failure so it can self-correct
        // syntactic mistakes (missing colons, bad indentation, etc.) without
        // forcing the user back to the input phase.
        const MAX_REPAIR = 2;
        for (let attempt = 1; parseError && attempt <= MAX_REPAIR; attempt++) {
          if (controller.signal.aborted) return;
          console.warn(`[ai-workflow] Parse failed (attempt ${attempt}/${MAX_REPAIR}): ${parseError}`);

          const repairPrompt = buildRepairUserPrompt(parseError, rawResponse);
          const repaired = await streamPhase(
            {
              ...commonBody,
              phase: "generate",
              plan: activePlan || undefined,
              // Repair prompt replaces the normal user prompt; include it via
              // description override so the server builder uses it verbatim.
              description: repairPrompt,
            },
            () => {},
            (c) => {
              setThinking((p) => p + c);
              if (c) setShowThinking(true);
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;

          // Preserve the prior response if the repair emitted only thinking
          // chunks — otherwise an empty repair would wipe useful context.
          if (repaired.fullText.trim()) {
            rawResponse = repaired.fullText;
            setGeneratedText(rawResponse);
          }
          extracted = extractSkillAndYaml(rawResponse);
          parseError = validateGeneratedYaml(extracted.yaml);
        }

        const { skillMd, yaml } = extracted;
        if (parseError) {
          // All repair attempts exhausted — show the raw response + error so
          // the user can copy it into a stronger LLM.
          console.error("[ai-workflow] Generation failed after auto-repair:", parseError);
          setParseFailure({ response: rawResponse, error: parseError });
          setPhase("input");
          return;
        }
        if (!yaml.trim()) {
          setError(t("workflow.ai.emptyResponse"));
          setPhase("input");
          return;
        }
        setGeneratedText(yaml);
        if (skillMd) setGeneratedSkillMd(skillMd);

        // ── PHASE 3: REVIEW ─────────────────────────────────────────────
        // First iteration only — subsequent re-reviews happen in runRefinement().
        setPhase("reviewing");
        setReviewText("");
        setParsedReview(undefined);
        setReviewIteration(0);

        const revResult = await streamPhase(
          {
            ...commonBody,
            phase: "review",
            plan: activePlan || undefined,
            generatedYaml: yaml,
          },
          (c) => setReviewText((p) => p + c),
          (c) => {
            setThinking((p) => p + c);
            if (c) setShowThinking(true);
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;

        const lastReview = parseReviewResponse(revResult.fullText);
        setParsedReview(lastReview);

        // Issues present, fail verdict, or unparseable — pause for user
        // decision. An unparseable review manifests as verdict="fail" with
        // issues=[] (see parseReviewResponse fallback); checking verdict
        // closes the gap so a malformed JSON response doesn't auto-advance.
        if (!lastReview || lastReview.issues.length > 0 || lastReview.verdict === "fail") {
          setPhase("reviewReady");
          return;
        }

        // ── Accepted — show preview ─────────────────────────────────────
        setHistory((prev) => [
          ...prev,
          { role: "user", text: desc },
          { role: "model", text: yaml },
        ]);
        setGeneratedText(yaml);
        if (skillMd) setGeneratedSkillMd(skillMd);
        setPhase("preview");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : t("workflow.ai.generationFailed"));
        setPhase("input");
      }
    },
    [
      mode, name, currentYaml, selectedModel, history, selectedExecutionSteps,
      isSkillMode, skillFolderId, existingInstructions, workflowFilePath,
      streamPhase, t,
    ],
  );

  // ── Refinement pass (invoked after user picks "Refine" on review) ──
  const runRefinement = useCallback(async () => {
    if (!parsedReview) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    // Incorporate user's feedback into the review summary so the refiner sees it.
    const feedback = reviewFeedback.trim();
    const review: ReviewResult = feedback
      ? {
          ...parsedReview,
          summary: `${parsedReview.summary}\n\nUSER FEEDBACK:\n${feedback}`,
        }
      : parsedReview;

    setPhase("refining");
    setReviewFeedback("");

    // Shared fields used by both refine and re-review calls. Keep in sync with
    // the initial generate/review call bodies so the LLM sees consistent context
    // (plan, skillMode, skillFolderName all matter for correct output).
    const refineBase = {
      mode,
      name: mode === "create" ? name.trim() : undefined,
      description: lastDescription,
      model: selectedModel,
      skillMode: isSkillMode || undefined,
      skillFolderName: isSkillMode && skillFolderId ? skillFolderId : undefined,
      plan: planText || undefined,
    };

    try {
      const { fullText, fullThinking } = await streamPhase(
        {
          ...refineBase,
          phase: "refine",
          previousYaml: generatedText,
          previousExplanation: generatedSkillMd || undefined,
          review,
        },
        () => {},
        (c) => {
          setThinking((p) => p + c);
          if (c) setShowThinking(true);
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      void fullThinking;

      const { skillMd, yaml } = extractSkillAndYaml(fullText);
      if (!yaml.trim()) {
        setError(t("workflow.ai.emptyResponse"));
        setPhase("reviewReady");
        return;
      }
      setGeneratedText(yaml);
      if (skillMd) setGeneratedSkillMd(skillMd);

      // Re-review the refined result.
      const nextIteration = reviewIteration + 1;
      setPhase("reviewing");
      setReviewText("");
      setParsedReview(undefined);
      setReviewIteration(nextIteration);

      const revResult = await streamPhase(
        {
          ...refineBase,
          phase: "review",
          generatedYaml: yaml,
        },
        (c) => setReviewText((p) => p + c),
        (c) => {
          setThinking((p) => p + c);
          if (c) setShowThinking(true);
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      const nextReview = parseReviewResponse(revResult.fullText);
      setParsedReview(nextReview);
      // Require both a clean verdict AND zero issues — an unparseable review
      // becomes verdict="fail" with issues=[], which must NOT auto-advance.
      if (nextReview && nextReview.verdict === "pass" && nextReview.issues.length === 0) {
        // Clean pass — auto-advance.
        setHistory((prev) => [
          ...prev,
          { role: "user", text: lastDescription },
          { role: "model", text: yaml },
        ]);
        setPhase("preview");
      } else {
        setPhase("reviewReady");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : t("workflow.ai.generationFailed"));
      setPhase("reviewReady");
    }
  }, [
    parsedReview, reviewFeedback, reviewIteration, mode, name, lastDescription,
    selectedModel, isSkillMode, skillFolderId, planText, generatedText,
    generatedSkillMd, streamPhase, t,
  ]);

  const handleGenerate = useCallback(() => {
    const desc = description.trim();
    if (!desc) return;
    if (mode === "create" && !name.trim()) return;
    setLastDescription(desc);
    void runPipeline(desc);
  }, [description, mode, name, runPipeline]);

  const handlePlanOk = useCallback(() => {
    void runPipeline(lastDescription, planText);
  }, [runPipeline, lastDescription, planText]);

  const handleReplan = useCallback(() => {
    const feedback = planFeedback.trim();
    const combined = feedback
      ? `${lastDescription}\n\nFEEDBACK ON PREVIOUS PLAN:\n${feedback}`
      : lastDescription;
    setPlanFeedback("");
    setPlanText("");
    void runPipeline(combined);
  }, [planFeedback, lastDescription, runPipeline]);

  const handleReviewOk = useCallback(() => {
    if (!parsedReview || parsedReview.issues.length === 0) {
      setHistory((prev) => [
        ...prev,
        { role: "user", text: lastDescription },
        { role: "model", text: generatedText },
      ]);
      setPhase("preview");
      return;
    }
    // Issues present — require explicit confirmation.
    if (typeof window !== "undefined" && !window.confirm(t("workflow.ai.acceptWithIssuesConfirm"))) {
      return;
    }
    setHistory((prev) => [
      ...prev,
      { role: "user", text: lastDescription },
      { role: "model", text: generatedText },
    ]);
    setPhase("preview");
  }, [parsedReview, lastDescription, generatedText, t]);

  const handleReviewRefine = useCallback(() => {
    void runRefinement();
  }, [runRefinement]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase("input");
  }, []);

  const handleAcceptPreview = useCallback(async () => {
    const workflowName = mode === "create" ? name.trim() : (currentName || "workflow");
    const skillFolderPath = isSkillMode && skillFolderId
      ? `${SKILLS_FOLDER_NAME}/${skillFolderId}/workflows`
      : undefined;
    const reviewDisplay = parsedReview
      ? formatReviewAsMarkdown(parsedReview, t)
      : (reviewText || undefined);
    try {
      await onAccept(generatedText, workflowName, {
        description: lastDescription,
        thinking,
        model: selectedModel,
        mode,
        history,
        skillFolderPath,
        skillMdContent: isSkillMode ? (generatedSkillMd || undefined) : undefined,
        newSkillId: isSkillMode && skillFolderId ? skillFolderId : undefined,
        generationContext: {
          plan: planText || undefined,
          thinking: thinking || undefined,
          review: reviewDisplay,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("workflow.ai.generationFailed");
      if (typeof window !== "undefined") window.alert(message);
      throw err;
    }
  }, [
    generatedText, generatedSkillMd, name, currentName, mode, onAccept,
    lastDescription, thinking, selectedModel, history, isSkillMode, skillFolderId,
    planText, parsedReview, reviewText, t,
  ]);

  const handleRejectPreview = useCallback(() => {
    setDescription("");
    setGeneratedSkillMd("");
    setPlanText("");
    setReviewText("");
    setParsedReview(undefined);
    setPlanFeedback("");
    setReviewFeedback("");
    setReviewIteration(0);
    setParseFailure(null);
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
          existingInstructions: mode === "modify" && isSkillMode ? existingInstructions : undefined,
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
      setTimeout(() => {
        pasteSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        pasteTextareaRef.current?.focus();
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("workflow.ai.generationFailed"));
    }
  }, [description, name, mode, currentYaml, selectedExecutionSteps, t, isSkillMode, skillFolderId, existingInstructions]);

  const handleApplyPasted = useCallback(async () => {
    const text = pastedText.trim();
    if (!text) {
      setError(t("workflow.ai.enterPastedYaml"));
      return;
    }

    const { skillMd, yaml } = extractSkillAndYaml(text);

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

  // ── Preview phase: hand off to the preview modal ──
  if (phase === "preview") {
    const reviewDisplay = parsedReview
      ? formatReviewAsMarkdown(parsedReview, t)
      : (reviewText || undefined);
    const generationContext: GenerationContext = {
      plan: planText || undefined,
      thinking: thinking || undefined,
      review: reviewDisplay,
    };
    return (
      <WorkflowPreviewModal
        yaml={generatedText}
        originalYaml={mode === "modify" ? currentYaml : undefined}
        mode={mode}
        workflowName={mode === "create" ? name : currentName}
        skillMd={generatedSkillMd || undefined}
        originalSkillMd={mode === "modify" && forceSkill ? existingInstructions : undefined}
        generationContext={generationContext}
        onAccept={handleAcceptPreview}
        onReject={handleRejectPreview}
        onClose={onClose}
      />
    );
  }

  const titleKey = mode === "create"
    ? (forceSkill ? "workflow.ai.createSkillTitle" : "workflow.ai.createTitle")
    : (forceSkill ? "workflow.ai.modifySkillTitle" : "workflow.ai.modifyTitle");

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
      <div className="mx-4 flex w-full max-w-lg flex-col rounded-lg bg-white shadow-xl dark:bg-gray-900" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={ICON.LG} className="text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t(titleKey)}
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
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Name (create mode only) */}
          {mode === "create" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {forceSkill ? t("workflow.ai.skillName") : t("workflow.ai.workflowName")}
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={forceSkill ? t("workflow.ai.skillNamePlaceholder") : t("workflow.ai.namePlaceholder")}
                disabled={isWorking}
                className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 disabled:opacity-50"
              />
              {forceSkill && skillFolderId && (
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                  {SKILLS_FOLDER_NAME}/{skillFolderId}/
                </p>
              )}
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {history.length > 0
                ? t("workflow.ai.refineLabel")
                : mode === "create"
                  ? (forceSkill ? t("workflow.ai.describeCreateSkill") : t("workflow.ai.describeCreate"))
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
                    ? (forceSkill ? t("workflow.ai.placeholderCreateSkill") : t("workflow.ai.createPlaceholder"))
                    : t("workflow.ai.modifyPlaceholder")
              }
              rows={4}
              disabled={isWorking}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 disabled:opacity-50 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            {existingInstructions && phase === "input" && (
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {/* Surfacing a hint that the skill body will be edited too */}
                SKILL.md + workflow
              </p>
            )}
          </div>

          {/* Execution History Reference (modify mode only) */}
          {mode === "modify" && workflowId && (
            <div>
              <button
                onClick={() => setShowHistorySelect(true)}
                disabled={isWorking}
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
              disabled={isWorking}
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

          {/* Parse-failure panel — shown when auto-repair exhausted retries.
              Keeps the dialog open with the raw response + copy button so the
              user can paste it into a stronger external LLM. */}
          {parseFailure && phase === "input" && (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-xs dark:border-red-800 dark:bg-red-900/20">
              <p className="mb-1 font-semibold text-red-700 dark:text-red-300">
                {t("workflow.ai.parseFailureTitle")}
              </p>
              <p className="mb-2 text-red-700 dark:text-red-300">{parseFailure.error}</p>
              <p className="mb-2 text-[11px] text-gray-600 dark:text-gray-400">
                {t("workflow.ai.parseFailureHint")}
              </p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(parseFailure.response).then(
                    () => { /* optional toast in future */ },
                    (err) => console.warn("[ai-workflow] clipboard copy failed:", err),
                  );
                }}
                className="mb-2 flex items-center gap-1.5 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/40"
              >
                <Copy size={ICON.SM} />
                {t("workflow.ai.parseFailureCopy")}
              </button>
              <pre className="max-h-48 overflow-auto rounded bg-white p-2 font-mono text-[11px] text-gray-700 dark:bg-gray-900 dark:text-gray-300 whitespace-pre-wrap">
                {parseFailure.response}
              </pre>
            </div>
          )}

          {/* Status line for active phases */}
          {(isWorking || phase === "planReady" || phase === "reviewReady") && (
            <PhaseStatus phase={phase} />
          )}

          {/* Plan display (planning + planReady) */}
          {(phase === "planning" || phase === "planReady") && (planText || phase === "planning") && (
            <div className="rounded border border-purple-200 bg-purple-50/50 dark:border-purple-900 dark:bg-purple-900/10">
              <div className="border-b border-purple-200 px-3 py-1.5 dark:border-purple-900">
                <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300">
                  {t("workflow.ai.phasePlan")}
                </span>
              </div>
              <div className="max-h-[40vh] overflow-y-auto p-3 text-xs prose prose-xs prose-sm max-w-none dark:prose-invert dark:text-gray-200">
                {planText ? (
                  <ReactMarkdown>{planText}</ReactMarkdown>
                ) : (
                  <p className="text-gray-400">{t("workflow.ai.planning")}…</p>
                )}
              </div>
            </div>
          )}

          {/* Plan Re-plan feedback (planReady only) */}
          {phase === "planReady" && (
            <div>
              <textarea
                value={planFeedback}
                onChange={(e) => setPlanFeedback(e.target.value)}
                placeholder={t("workflow.ai.planReplanPlaceholder")}
                rows={2}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 resize-none"
              />
            </div>
          )}

          {/* Review display */}
          {(phase === "reviewing" || phase === "reviewReady" || phase === "refining") && (
            <div className="rounded border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-900/10">
              <div className="border-b border-amber-200 px-3 py-1.5 dark:border-amber-900">
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  {t("workflow.ai.phaseReview")}
                  {reviewIteration > 0 && ` (${reviewIteration + 1})`}
                </span>
              </div>
              <div className="max-h-[40vh] overflow-y-auto p-3 text-xs">
                {parsedReview ? (
                  <ReviewDisplay review={parsedReview} />
                ) : reviewText ? (
                  <pre className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 font-mono">
                    {reviewText}
                  </pre>
                ) : (
                  <p className="text-gray-400">{t("workflow.ai.reviewing")}…</p>
                )}
              </div>
            </div>
          )}

          {/* Refine feedback (reviewReady only) */}
          {phase === "reviewReady" && parsedReview && parsedReview.issues.length > 0 && (
            <div>
              <textarea
                value={reviewFeedback}
                onChange={(e) => setReviewFeedback(e.target.value)}
                placeholder={t("workflow.ai.refinePlaceholderReview")}
                rows={2}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 resize-none"
              />
            </div>
          )}

          {/* Thinking section — shared across phases */}
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
                  className="mt-1 max-h-[25vh] overflow-y-auto rounded bg-gray-50 p-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-mono whitespace-pre-wrap"
                >
                  {thinking}
                </div>
              )}
            </div>
          )}

          {/* Generation text streaming preview */}
          {phase === "generating" && generatedText && (
            <div className="max-h-24 overflow-y-auto rounded bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300 font-mono whitespace-pre-wrap">
              {generatedText.slice(0, 300)}
              {generatedText.length > 300 && "..."}
            </div>
          )}
        </div>

        {/* Footer — dynamic based on phase */}
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

            {isWorking && (
              <button
                onClick={handleCancel}
                className="rounded bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
              >
                {t("workflow.ai.stop")}
              </button>
            )}

            {phase === "input" && (
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

            {phase === "planReady" && (
              <>
                <button
                  onClick={handleReplan}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {t("workflow.ai.planReplan")}
                </button>
                <button
                  onClick={handlePlanOk}
                  className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
                >
                  <Check size={ICON.SM} />
                  {t("workflow.ai.planOk")}
                </button>
              </>
            )}

            {phase === "reviewReady" && (
              <>
                <button
                  onClick={handleReviewRefine}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {t("workflow.ai.refineBtn")}
                </button>
                <button
                  onClick={handleReviewOk}
                  className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                >
                  <Check size={ICON.SM} />
                  {t("workflow.ai.planOk")}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Paste response section — below footer, unchanged */}
        {showPasteSection && phase === "input" && (
          <div ref={pasteSectionRef} className="border-t border-gray-200 px-4 py-3 dark:border-gray-700 space-y-2">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("workflow.ai.pasteLabel")}
            </label>
            <textarea
              ref={pasteTextareaRef}
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

// ── Sub-components ────────────────────────────────────────────────────────

function PhaseStatus({ phase }: { phase: Phase }) {
  const { t } = useI18n();
  const label = (() => {
    switch (phase) {
      case "planning": return t("workflow.ai.planning");
      case "planReady": return t("workflow.ai.planComplete");
      case "generating": return t("workflow.ai.generating");
      case "reviewing": return t("workflow.ai.reviewing");
      case "reviewReady": return t("workflow.ai.reviewComplete");
      case "refining": return t("workflow.ai.refining");
      default: return "";
    }
  })();
  const isSpinning = phase === "planning" || phase === "generating" || phase === "reviewing" || phase === "refining";
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      {isSpinning && <Loader2 size={ICON.SM} className="animate-spin" />}
      <span>{label}</span>
    </div>
  );
}

function ReviewDisplay({ review }: { review: ReviewResult }) {
  const { t } = useI18n();
  if (review.issues.length === 0) {
    return (
      <div className="space-y-1">
        <p className="font-medium text-green-700 dark:text-green-300">
          ✓ {t("workflow.ai.reviewVerdictPass")}
        </p>
        {review.summary && (
          <p className="text-gray-600 dark:text-gray-400">{review.summary}</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="font-medium text-red-700 dark:text-red-300">
        {t("workflow.ai.reviewVerdictFail")}
      </p>
      {review.summary && (
        <div>
          <p className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400">
            {t("workflow.ai.reviewSummary")}
          </p>
          <p className="text-gray-700 dark:text-gray-300">{review.summary}</p>
        </div>
      )}
      <div>
        <p className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400">
          {t("workflow.ai.reviewIssues")}
        </p>
        <ul className="mt-1 space-y-1">
          {review.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-0.5 flex-shrink-0">
                {issue.severity === "high" ? (
                  <AlertCircle size={12} className="text-red-500" />
                ) : issue.severity === "medium" ? (
                  <AlertTriangle size={12} className="text-amber-500" />
                ) : (
                  <Info size={12} className="text-blue-500" />
                )}
              </span>
              <span className="flex-1 text-gray-700 dark:text-gray-300">
                <span className="font-semibold">
                  [{t(`workflow.ai.severity${issue.severity === "high" ? "High" : issue.severity === "medium" ? "Medium" : "Low"}` as const)}]
                </span>{" "}
                {issue.description}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Convert a parsed ReviewResult to markdown for the preview modal's context panel. */
function formatReviewAsMarkdown(review: ReviewResult, t: TFn): string {
  const lines: string[] = [];
  if (review.issues.length === 0) {
    lines.push(`**${t("workflow.ai.reviewVerdictPass")}**`);
    if (review.summary) lines.push("", review.summary);
    return lines.join("\n");
  }
  lines.push(`**${t("workflow.ai.reviewVerdictFail")}**`);
  if (review.summary) lines.push("", review.summary);
  lines.push("", `### ${t("workflow.ai.reviewIssues")}`);
  for (const issue of review.issues) {
    const sev = issue.severity === "high"
      ? t("workflow.ai.severityHigh")
      : issue.severity === "medium"
        ? t("workflow.ai.severityMedium")
        : t("workflow.ai.severityLow");
    const icon = issue.severity === "high" ? "🔴" : issue.severity === "medium" ? "🟡" : "🔵";
    lines.push(`- ${icon} **[${sev}]** ${issue.description}`);
  }
  return lines.join("\n");
}
