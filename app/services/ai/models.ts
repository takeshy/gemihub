/**
 * Unified AI model registry.
 *
 * Both providers read from here: `genai-key` (browser, the user's own Gemini
 * API key — pricing tables below) and `vertex` (org project mounts —
 * VERTEX_MODELS, narrowed per project by allowedModels/assertModelAllowed).
 */

// Model pricing per token (USD) for the genai-key provider.
// Source: https://ai.google.dev/pricing
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.7-flash":       { input: 1.50 / 1e6, output: 7.50 / 1e6 },
  "gemini-3.5-flash-lite": { input: 0.30 / 1e6, output: 2.50 / 1e6 },
  "gemini-3.1-pro-preview": { input: 2.00 / 1e6, output: 12.00 / 1e6 },
  "gemini-3.1-pro-preview-customtools": { input: 2.00 / 1e6, output: 12.00 / 1e6 },
  "gemini-3-pro-image-preview": { input: 2.00 / 1e6, output: 120.00 / 1e6 },
  "gemini-3.1-flash-image-preview": { input: 0.25 / 1e6, output: 60.00 / 1e6 },
};

/**
 * Models that run on Vertex only, so they have no entry in the published
 * Gemini API table above. Same per-token shape.
 */
export const VERTEX_ONLY_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemma-4-31b-it": { input: 1.00 / 1e6, output: 1.00 / 1e6 },
  "gemma-4-26b-a4b-it": { input: 1.00 / 1e6, output: 1.00 / 1e6 },
};

/** Every model an organization or personal Vertex budget can be charged for. */
export const VERTEX_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  ...MODEL_PRICING,
  ...VERTEX_ONLY_MODEL_PRICING,
};

/**
 * Whether a model has a published Vertex price. A deployment can price more
 * models through VERTEX_AI_PRICING_JSON, which only the server sees — use
 * `isVertexModelPriced` there. This is the client-safe view, for deciding
 * which models the settings UI may offer on a prepaid balance.
 */
export function hasVertexPrice(model: string): boolean {
  return Object.hasOwn(VERTEX_MODEL_PRICING, model);
}

// Grounding with Google Search cost per prompt (USD)
export const SEARCH_GROUNDING_COST: Record<string, number> = {
  "gemini-3.7-flash": 14 / 1000,
  "gemini-3.1-pro-preview": 14 / 1000,
  "gemini-3.1-pro-preview-customtools": 14 / 1000,
  "gemini-3-pro-image-preview": 14 / 1000,
  "gemini-3.1-flash-image-preview": 14 / 1000,
  "gemini-3.5-flash-lite": 14 / 1000,
};

/**
 * Default model identifiers for org projects (Vertex provider). The Gemini 3
 * series is `preview` in the Vertex catalogue but is the production-grade
 * choice. Per-project allowed-models lists narrow this further at runtime.
 */
export const VERTEX_MODELS = {
  pro: "gemini-3.1-pro-preview",
  flash: "gemini-3.7-flash",
  flashLite: "gemini-3.5-flash-lite",
  gemma4: "gemma-4-31b-it",
  gemma4Moe: "gemma-4-26b-a4b-it",
  proImage: "gemini-3-pro-image-preview",
} as const;

export type VertexModelKey = keyof typeof VERTEX_MODELS;
