// Frontmatter writeback — update a single key in a .md file's frontmatter
// while preserving the body, all other keys, and key insertion order.
//
// Invariants (P1b spec §7.2 — deviation prohibited):
//   1. Body (markdown after frontmatter) is fully preserved.
//   2. Frontmatter keys other than the target are not lost (unknown keys included).
//   3. Key insertion order is preserved. Existing-key updates keep their position.
//      New keys are appended at the end.
//   4. Unparseable frontmatter files are not written (returns null).

import yaml from "js-yaml";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const YAML_DUMP_OPTS: yaml.DumpOptions = { lineWidth: -1, noRefs: true };

export interface FrontmatterWriteResult {
  content: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Parse frontmatter + body from markdown content.
 * Returns null if the frontmatter YAML is unparseable (caller must not write).
 * Returns { frontmatter: {}, body: content, raw: "", hasFrontmatter: false }
 * when there is no frontmatter block at all.
 */
export function splitFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
  hasFrontmatter: boolean;
} | null {
  if (!content) return { frontmatter: {}, body: "", raw: "", hasFrontmatter: false };
  const m = content.match(FM_RE);
  if (!m) return { frontmatter: {}, body: content, raw: "", hasFrontmatter: false };
  const raw = m[1];
  try {
    const parsed = yaml.load(raw);
    if (parsed === null || parsed === undefined) {
      // Empty frontmatter block (---\n---)
      return { frontmatter: {}, body: content.slice(m[0].length), raw, hasFrontmatter: true };
    }
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        frontmatter: parsed as Record<string, unknown>,
        body: content.slice(m[0].length),
        raw,
        hasFrontmatter: true,
      };
    }
    // Non-object YAML (e.g. a bare string) — unparseable as frontmatter
    return null;
  } catch {
    return null;
  }
}

/**
 * Update a single frontmatter key in markdown content.
 *
 * - Preserves the body verbatim.
 * - Preserves all existing keys and their insertion order.
 * - If the key already exists, updates its value in-place.
 * - If the key is new, appends it at the end.
 * - If value is null/undefined, removes the key.
 *
 * Returns null if the file's frontmatter is unparseable (spec §7.2 invariant 4).
 * Returns the updated content and parsed frontmatter on success.
 */
export function updateFrontmatterKey(
  content: string,
  key: string,
  value: unknown,
): FrontmatterWriteResult | null {
  const split = splitFrontmatter(content);
  if (split === null) return null; // unparseable — do not write

  const fm = split.frontmatter;

  if (value === null || value === undefined) {
    if (key in fm) {
      delete fm[key];
    }
  } else if (key in fm) {
    // Update existing key in-place (preserves order)
    fm[key] = value;
  } else {
    // New key — append at end
    fm[key] = value;
  }

  const body = split.body;
  // Removing the last key leaves an empty object, which would serialize to a
  // literal "{}". Drop the frontmatter block entirely instead — there are no
  // keys left to preserve, and the body is kept verbatim.
  if (Object.keys(fm).length === 0) {
    return { content: body, frontmatter: fm };
  }
  const yamlStr = yaml.dump(fm, YAML_DUMP_OPTS);
  const newContent = `---\n${yamlStr}---\n${body}`;

  return { content: newContent, frontmatter: fm };
}
