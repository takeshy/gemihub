// Server-side prompt builders for the 3-phase
// (plan → generate → review → refine) AI workflow generation pipeline.
// Client-safe types and the review parser live in `./ai-workflow-generation.ts`.

import type { Language } from "~/types/settings";
import type { ReviewResult } from "./ai-workflow-generation";
export { parseReviewResponse } from "./ai-workflow-generation";
export type { ReviewIssue, ReviewResult, GenerationContext } from "./ai-workflow-generation";

export const LOCALE_NAMES: Record<Language, string> = {
  en: "English",
  ja: "Japanese (日本語)",
};

export function languageName(locale?: Language | null): string {
  return LOCALE_NAMES[locale ?? "en"] ?? "English";
}

// ── Phase 1: Planning ─────────────────────────────────────────────────────

export function buildPlanSystemPrompt(isSkill: boolean, locale?: Language | null): string {
  const lang = languageName(locale);
  const skillGuidance = isSkill
    ? `

For skills (reusable tools the AI assistant can trigger), also cover:
- When this skill should activate (what the user might say or ask)
- What input the user provides
- What the skill produces as output`
    : "";

  return `You help users plan what their GemiHub automation should do. Write the plan so anyone can understand it — NOT just engineers.

Describe the plan in plain language covering:
1. **What it does** — The goal in one or two sentences
2. **Steps** — What happens, in order, as numbered bullet points (e.g., "Ask the user for a topic", "Search Drive for related notes", "Show the results")
3. **Inputs** — What information is needed from the user or environment
4. **Outputs** — What the user gets when it finishes
5. **Things to watch out for** — Potential issues in plain language (e.g., "What if no notes are found?")
${skillGuidance}

IMPORTANT RULES:
- Write the ENTIRE plan in ${lang}.
- Avoid technical jargon. Do NOT mention node types, YAML, variable names, or implementation details.
- Use simple sentences a non-engineer could follow.
- Keep it concise — roughly 10–20 short bullet points total.
- Do NOT generate any code or YAML.`;
}

export function buildPlanUserPrompt(options: {
  name?: string;
  description: string;
  currentYaml?: string;
  isSkill: boolean;
}): string {
  const entityType = options.isSkill ? "skill" : "workflow";
  const named = options.name ? `named "${options.name}" ` : "";
  const existingContext = options.currentYaml
    ? `\n\nEXISTING WORKFLOW TO MODIFY:\n${options.currentYaml}`
    : "";
  return `Plan a ${entityType} ${named}that does the following:

${options.description}${existingContext}`;
}

// ── Phase 3: Review ───────────────────────────────────────────────────────

export function buildReviewSystemPrompt(
  isSkill: boolean,
  workflowSpec: string,
  locale?: Language | null,
): string {
  const lang = languageName(locale);
  const skillReviewChecks = isSkill
    ? `
5. **Skill instructions quality**: Are instructions written in imperative form? Do they explain WHY behind each guideline (not just rigid rules)? Are they concise (under 500 lines)?
6. **Skill description**: Does the description specify both what the skill does AND when to use it? Is it specific enough to trigger reliably?
7. **Input/output design**: Does the workflow have clear input variables for the AI to provide? Are outputs meaningful for continuing the conversation?`
    : "";

  return `You are a workflow quality reviewer for GemiHub. Evaluate the generated workflow YAML against the original request and plan.

Check for:
1. **Completeness**: Does the workflow fulfill all aspects of the request?
2. **Correctness**: Are node types valid? Are connections (next, trueNext, falseNext) properly set? Are variables initialized before use? NOTE: The \`value\` field on a variable node is OPTIONAL — omitting it defaults to "" for new variables and preserves the existing value for variables already set (input declaration). Do NOT flag missing \`value\` as an issue; only flag real problems (wrong type, broken references, undefined variables being read, etc.).
   IMPORTANT: Do NOT flag "workflow does not output variable X to chat" as an issue. When a skill workflow runs, ALL variables whose name does not start with \`_\` are automatically returned to the chat AI, which presents them to the user as guided by the SKILL.md instructions. A final \`command\` node just to "display" a value is UNNECESSARY — a \`command\` node runs an LLM call inside the workflow and saves to a variable; it does not write directly to the chat. If the concern is that the user should see a specific variable, the fix belongs in the SKILL.md instructions body (e.g., "output \`ogpMarkdown\` verbatim"), not in the workflow YAML.
3. **Data flow**: Do saveTo variables match where they're referenced? Are there dangling references?
4. **Best practices**: Descriptive node IDs? Comments on complex nodes? Proper error handling?
5. **Variable interpolation in script nodes**: \`{{var:json}}\` does NOT add quotes — it only escapes content. Flag any occurrence where \`{{var:json}}\` appears without surrounding quotes in a JavaScript string context (e.g., \`var x = {{var:json}}\`, \`JSON.parse({{var:json}})\`). The correct form is \`"{{var:json}}"\` when the value should be a string literal.
6. **json node source**: The \`source\` field must be a bare variable name (no \`{{...}}\`, no surrounding quotes, no wrapping like \`"[{{var}}]"\`). Flag any \`source\` that uses interpolation or wrapping.
7. **http throwOnError silent-failure anti-pattern**: The default for \`throwOnError\` is \`"true"\` (HTTP 4xx/5xx aborts the workflow). Flag any \`http\` node that sets \`throwOnError: "false"\` **without** a corresponding error-handling branch downstream (e.g., an \`if\` node reading \`saveStatus\` and taking a different path on >= 400). Suppressing HTTP errors hides failures from the chat AI and the user, and blocks the "Open workflow" recovery UI. Also flag downstream \`script\` nodes that only inspect \`saveStatus\` to return an "error" string — that's the same silent-failure anti-pattern. The fix is to remove \`throwOnError: "false"\` (restoring the throwing default).${skillReviewChecks}

WORKFLOW SPECIFICATION (for reference):
${workflowSpec}

Output your review as JSON (no markdown code fences):
{
  "verdict": "pass" or "fail",
  "summary": "Brief overall assessment",
  "issues": [
    {
      "severity": "high" or "medium" or "low",
      "description": "Description of the issue"
    }
  ]
}

IMPORTANT:
- Write the "summary" and every issue "description" in ${lang}.
- Use plain, non-technical language a non-engineer can understand (avoid jargon like node types, YAML field names, or variable references unless absolutely necessary).
- The JSON keys themselves ("verdict", "summary", "issues", "severity", "description") must remain in English.
- "high" severity: The workflow will fail or produce wrong results (missing variables, invalid node types, broken connections).
- "medium"/"low" severity: Quality improvements, not critical.
- Set verdict to "fail" only if there are "high" severity issues.
- If the workflow looks correct, return verdict "pass" with an empty issues array.`;
}

export function buildReviewUserPrompt(options: {
  description: string;
  plan?: string;
  generatedYaml: string;
  isSkill: boolean;
}): string {
  const entityType = options.isSkill ? "skill" : "workflow";
  const planSection = options.plan ? `\nPLAN:\n${options.plan}\n` : "";
  return `Review this generated ${entityType}:

ORIGINAL REQUEST:
${options.description}
${planSection}
GENERATED YAML:
${options.generatedYaml}`;
}

// ── Phase 4: Refinement ────────────────────────────────────────────────────

export function buildRefineUserPrompt(options: {
  description: string;
  plan?: string;
  previousYaml: string;
  previousExplanation?: string;
  review: ReviewResult;
  isSkill: boolean;
}): string {
  const { description, plan, previousYaml, previousExplanation, review, isSkill } = options;

  const issuesText = review.issues
    .map((i) => `- [${i.severity}] ${i.description}`)
    .join("\n");
  const planSection = plan ? `\nPLAN:\n${plan}\n` : "";

  let generatedOutput: string;
  let outputInstruction: string;
  if (isSkill && previousExplanation) {
    generatedOutput = `GENERATED SKILL.md INSTRUCTIONS:\n${previousExplanation}\n\nGENERATED YAML:\n${previousYaml}`;
    outputInstruction = `Fix all high-severity issues. Output the corrected SKILL.md instructions body first, then a line containing only "===WORKFLOW===", then the corrected complete YAML inside a \`\`\`yaml code fence.`;
  } else {
    generatedOutput = `GENERATED YAML:\n${previousYaml}`;
    outputInstruction = `Fix all high-severity issues and output the corrected complete YAML, starting with "name:".`;
  }

  const feedbackSection = review.rawText
    ? `REVIEW FEEDBACK (raw):\n${review.rawText}`
    : `REVIEW FEEDBACK:\n${review.summary}\n${issuesText}`;

  return `The following ${isSkill ? "skill" : "workflow"} was generated but the reviewer found issues that must be fixed:

ORIGINAL REQUEST:
${description}
${planSection}
${generatedOutput}

${feedbackSection}

${outputInstruction}`;
}

// ── Phase 2: Generate (user prompt enrichment) ────────────────────────────

/** Prepends a "USER-APPROVED PLAN" section to an existing user prompt. */
export function attachPlanToUserPrompt(userPrompt: string, plan?: string): string {
  if (!plan) return userPrompt;
  const planSection = `USER-APPROVED PLAN (plain-language description of the desired behavior):
${plan}

Translate this plan into concrete workflow nodes. The plan describes WHAT the workflow should do; you decide HOW (which nodes, variables, and connections to use).

`;
  return planSection + userPrompt;
}
