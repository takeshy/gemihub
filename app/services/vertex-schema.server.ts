/**
 * Helpers for using `responseJsonSchema` (preview) safely on Vertex.
 *
 * Vertex returns 400 on schemas that nest deeper than ~7 levels. The lisa
 * Rails app hit this in production; we pre-emptively measure depth and
 * fall back to inlining the schema in the prompt with `responseMimeType:
 * application/json` only.
 *
 * See docs/enterprise.md §8.4.
 */

/** Empirical ceiling — schemas at or below this depth are sent as-is. */
export const SCHEMA_MAX_NESTING_DEPTH = 7;

/**
 * Recursively measure the maximum nesting depth of a JSON schema.
 *   - `properties.{key}` adds 1
 *   - `items` adds 1
 *   - `oneOf/anyOf/allOf` are flattened (do not add to depth)
 *
 * A flat schema like `{ type: "object", properties: { x: { type: "string" } } }`
 * has depth 1.
 */
export function schemaNestingDepth(schema: unknown): number {
  if (schema === null || typeof schema !== "object") return 0;
  const s = schema as Record<string, unknown>;
  let max = 0;

  if (s.properties && typeof s.properties === "object") {
    for (const v of Object.values(s.properties as Record<string, unknown>)) {
      max = Math.max(max, schemaNestingDepth(v) + 1);
    }
  }

  if (s.items !== undefined) {
    if (Array.isArray(s.items)) {
      for (const v of s.items) max = Math.max(max, schemaNestingDepth(v) + 1);
    } else {
      max = Math.max(max, schemaNestingDepth(s.items) + 1);
    }
  }

  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const branches = s[key];
    if (Array.isArray(branches)) {
      for (const v of branches) max = Math.max(max, schemaNestingDepth(v));
    }
  }

  return max;
}

export type SchemaMode = "schema" | "inline";

export interface SchemaModeResult {
  mode: SchemaMode;
  depth: number;
}

/**
 * Decide how to ask Vertex for JSON output for the given schema.
 *   - `schema` → set `generationConfig.responseJsonSchema = schema`
 *   - `inline` → drop the schema field, prepend it into the user prompt,
 *     and set `responseMimeType = "application/json"` only.
 */
export function chooseSchemaMode(schema: unknown): SchemaModeResult {
  const depth = schemaNestingDepth(schema);
  return {
    mode: depth <= SCHEMA_MAX_NESTING_DEPTH ? "schema" : "inline",
    depth,
  };
}

/** Build the prompt text for `inline` mode. */
export function buildInlineSchemaPrompt(originalPrompt: string, schema: unknown): string {
  const schemaJson = JSON.stringify(schema);
  return `Output ONLY JSON that conforms to this schema. No prose, no markdown fences.\n${schemaJson}\n\n${originalPrompt}`;
}
