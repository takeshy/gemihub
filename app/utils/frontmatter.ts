import yaml from "js-yaml";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

/**
 * Parse frontmatter from markdown content.
 * Returns {} for files without frontmatter or with invalid YAML.
 * Never throws — invalid frontmatter is treated as {}.
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content) return {};
  const m = content.match(FM_RE);
  if (!m) return {};
  try {
    const parsed = yaml.load(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // invalid YAML — treat as empty
  }
  return {};
}

/**
 * Check if a file is a markdown file based on fileName.
 */
export function isMarkdownFile(fileName?: string): boolean {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}
