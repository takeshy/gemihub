export const visualGenerationTimeoutMs = 120000;
export type VisualStage = "preparing" | "identifying" | "generating" | "reviewing" | "repairing" | "complete" | "failed";
export type VisualGenerationProgress = {
  shopId: string; visualId: string; requestId: string; stage: VisualStage;
  attempt: number; startedAt: number; updatedAt: number; error?: string;
  lastReview?: { approved: boolean; issues: string[] };
  instruction?: string;
};
