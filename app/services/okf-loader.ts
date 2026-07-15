import yaml from "js-yaml";
import {
  getCachedFile,
  getCachedFileTree,
  getCachedRemoteMeta,
  type CachedTreeNode,
} from "./indexeddb-cache";
import { fixMarkdownBullets } from "~/utils/yaml-helpers";

interface OkfDocument {
  path: string;
  title: string;
  type: string;
  description: string;
  tags: string[];
  body: string;
}

export interface OkfBundle {
  id: string;
  name: string;
}

interface MarkdownRef {
  path: string;
  fileId: string;
}

// A fetched document should normally reach the model in full. Keep only a
// generous per-file guard so an unexpectedly large Drive file cannot dominate
// a prompt or a single tool result.
const MAX_BODY_CHARS = 20_000;
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(FM_RE);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const parsed = yaml.load(fixMarkdownBullets(match[1]));
    return {
      frontmatter: parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {},
      body: match[2],
    };
  } catch {
    return { frontmatter: {}, body: match[2] };
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function rootBasename(root: string): string {
  return normalizePath(root).split("/").filter(Boolean).pop() || "OKF";
}

function findPathRoot(nodes: CachedTreeNode[], parts: string[]): CachedTreeNode[] {
  let children = nodes;
  for (const part of parts) {
    const next = children.find((node) => node.isFolder && node.name.toLowerCase() === part.toLowerCase());
    if (!next?.children) return [];
    children = next.children;
  }
  return children;
}

function collectMarkdown(nodes: CachedTreeNode[], prefix = ""): MarkdownRef[] {
  const refs: MarkdownRef[] = [];
  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
  for (const node of sorted) {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.isFolder) {
      if (node.name === ".git" || node.name === "node_modules") continue;
      refs.push(...collectMarkdown(node.children ?? [], path));
    } else if (node.name.toLowerCase().endsWith(".md")) {
      refs.push({ path, fileId: node.id });
    }
  }
  return refs;
}

async function listMarkdown(root: string): Promise<MarkdownRef[]> {
  // Remote meta also contains new local-first files (`new:` IDs), while the
  // cached folder tree is refreshed only after Drive sync. Prefer it so an OKF
  // update is available to the very next chat message.
  const meta = await getCachedRemoteMeta();
  if (meta) {
    const normalizedRoot = normalizePath(root);
    const prefix = normalizedRoot ? `${normalizedRoot}/` : "";
    return Object.entries(meta.files)
      .filter(([, entry]) => {
        const name = normalizePath(entry.name);
        return name.toLowerCase().endsWith(".md") && (!prefix || name.toLowerCase().startsWith(prefix.toLowerCase()));
      })
      .map(([fileId, entry]) => ({
        fileId,
        path: prefix ? normalizePath(entry.name).slice(prefix.length) : normalizePath(entry.name),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  const tree = await getCachedFileTree();
  if (!tree) return [];
  const normalizedRoot = normalizePath(root);
  const rootNodes = normalizedRoot ? findPathRoot(tree.items, normalizedRoot.split("/").filter(Boolean)) : tree.items;
  return collectMarkdown(rootNodes);
}

function isLogFile(path: string): boolean {
  return path.toLowerCase() === "log.md" || path.toLowerCase().endsWith("/log.md");
}

function isIndexFile(path: string): boolean {
  return path.toLowerCase() === "index.md" || path.toLowerCase().endsWith("/index.md");
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export async function discoverOkfBundles(root: string): Promise<OkfBundle[]> {
  const refs = await listMarkdown(root);
  const indexRefs = refs.filter((ref) => isIndexFile(ref.path));
  // A subdirectory index.md inside another bundle (per-directory index for
  // progressive disclosure) is part of that bundle, not a bundle of its own —
  // only top-level bundle folders are listed.
  const dirs = indexRefs.map((ref) => dirOf(ref.path));
  const topLevelRefs = indexRefs.filter((ref) => {
    const dir = dirOf(ref.path);
    return !dirs.some((other) => other !== dir && (other === "" || dir.startsWith(`${other}/`)));
  });
  const bundles: OkfBundle[] = [];
  for (const ref of topLevelRefs) {
    const id = dirOf(ref.path);
    let name = id.split("/").pop() || rootBasename(root);
    const cached = await getCachedFile(ref.fileId);
    if (cached?.content) {
      const title = asString(parseFrontmatter(cached.content).frontmatter.title);
      if (title) name = title;
    }
    bundles.push({ id, name });
  }
  return bundles.sort((a, b) => a.name.localeCompare(b.name));
}

async function toDocument(ref: MarkdownRef): Promise<OkfDocument | null> {
  const cached = await getCachedFile(ref.fileId);
  if (!cached?.content) return null;
  const { frontmatter, body } = parseFrontmatter(cached.content);
  return {
    path: ref.path,
    title: asString(frontmatter.title) || ref.path.replace(/\.md$/i, ""),
    type: asString(frontmatter.type) || (isIndexFile(ref.path) ? "Index" : "Concept"),
    description: asString(frontmatter.description),
    tags: asTags(frontmatter.tags),
    // Preserve Markdown structure (headings, lists, tables, and code blocks).
    // Collapsing whitespace here makes both the injected index and on-demand
    // document bodies substantially harder for the model to interpret.
    body: body.trim().slice(0, MAX_BODY_CHARS),
  };
}

function formatIndexSection(bundleId: string, bundleName: string, index: OkfDocument): string {
  const description = index.description ? ` - ${index.description}` : "";
  return `\n## OKF bundle: ${bundleName} (bundleId=${bundleId})${description}\n${index.body}`;
}

/**
 * Builds the system-prompt text for the active OKF bundles. Only a bundle's
 * `index.md` is inlined — its other documents are meant to be fetched on
 * demand via `read_okf_document`, the same "load full content only when
 * actually needed" pattern used for SKILL.md (see skill-loader.ts's
 * `read_drive_file` instruction) rather than eagerly dumping every document's
 * body into every turn.
 */
export async function buildOkfSystemPrompt(root: string, selectedBundleIds: string[]): Promise<string> {
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot || selectedBundleIds.length === 0) return "";

  const refs = await listMarkdown(normalizedRoot);
  if (refs.length === 0) return "";

  const sections: string[] = [];
  for (const bundleId of selectedBundleIds) {
    const indexPath = bundleId ? `${bundleId}/index.md` : "index.md";
    const indexRef = refs.find((ref) => ref.path === indexPath);
    if (!indexRef) continue;
    const index = await toDocument(indexRef);
    if (!index) continue;
    const name = index.title || bundleId.split("/").pop() || rootBasename(normalizedRoot);
    sections.push(formatIndexSection(bundleId, name, index));
  }
  if (sections.length === 0) return "";

  const intro =
    "The following Open Knowledge Format (OKF) knowledge bundles are active. Each bundle section below is only that bundle's index document (its table of contents) — not the full knowledge base. When the index alone doesn't give enough detail to answer, call the read_okf_document tool with the bundleId shown in the section heading and a document path referenced in that index (leading slashes are fine) to fetch that document's full content. Prefer these curated bundles' definitions, relationships, and documented procedures when answering domain questions. If relevant knowledge may exist outside these excerpts, use Drive tools or semantic search when available before guessing.";
  return `${intro}\n${sections.join("\n")}`;
}

/**
 * Resolves a `read_okf_document` tool call: fetches one document's full body
 * by bundle + path, reusing the same Markdown listing and frontmatter parsing
 * as bundle discovery. Returns null if the bundle, path, or file can't be
 * resolved, or if the path points at a bundle's private `log.md`.
 */
export async function readOkfDocument(root: string, bundleId: string, path: string): Promise<OkfDocument | null> {
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot) return null;
  const cleanPath = normalizePath(path);
  if (!cleanPath || isLogFile(cleanPath)) return null;
  const fullPath = bundleId ? `${normalizePath(bundleId)}/${cleanPath}` : cleanPath;
  const refs = await listMarkdown(normalizedRoot);
  const ref = refs.find((candidate) => candidate.path === fullPath);
  if (!ref) return null;
  return toDocument(ref);
}
