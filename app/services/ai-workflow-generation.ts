// Client-safe types and helpers for the 3-phase AI workflow generation pipeline.
// The server-only prompt builders live in `ai-workflow-generation.server.ts`.

export interface ReviewIssue {
  severity: "high" | "medium" | "low";
  description: string;
}

export interface ReviewResult {
  verdict: "pass" | "fail";
  summary: string;
  issues: ReviewIssue[];
  rawText?: string;
}

export interface GenerationContext {
  plan?: string;
  thinking?: string;
  review?: string;
}

/**
 * Parse the reviewer LLM's JSON response into a ReviewResult.
 * Tolerant of markdown code fences and slightly malformed JSON.
 */
export function parseReviewResponse(text: string): ReviewResult | undefined {
  const raw = text.trim();
  if (!raw) return undefined;

  let body = raw;
  const fence = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) body = fence[1];

  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return undefined;

    const verdict = parsed.verdict === "fail" ? "fail" : "pass";
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const issuesRaw = Array.isArray(parsed.issues) ? parsed.issues : [];
    const issues: ReviewIssue[] = issuesRaw
      .map((i: unknown): ReviewIssue | null => {
        if (!i || typeof i !== "object") return null;
        const o = i as { severity?: unknown; description?: unknown };
        const sev =
          o.severity === "high" || o.severity === "medium" || o.severity === "low"
            ? o.severity
            : "medium";
        const desc = typeof o.description === "string" ? o.description : "";
        if (!desc) return null;
        return { severity: sev, description: desc };
      })
      .filter((i: ReviewIssue | null): i is ReviewIssue => i !== null);

    return { verdict, summary, issues, rawText: raw };
  } catch (err) {
    // Reviewer emitted unparseable output — surface the raw text so the user
    // (and the refinement pass) can still see what it said.
    console.warn("[ai-workflow] parseReviewResponse: JSON parse failed, returning raw:", err);
    return { verdict: "fail", summary: raw, issues: [], rawText: raw };
  }
}
