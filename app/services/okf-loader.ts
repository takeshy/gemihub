import yaml from "js-yaml";
import {
  getCachedFile,
  getCachedFileTree,
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

const MAX_DOCS_PER_BUNDLE = 24;
const MAX_BODY_CHARS = 1400;
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

function refInBundle(refPath: string, bundleId: string): boolean {
  return bundleId === "" ? true : refPath === bundleId || refPath.startsWith(`${bundleId}/`);
}

export async function discoverOkfBundles(root: string): Promise<OkfBundle[]> {
  const refs = await listMarkdown(root);
  const bundles: OkfBundle[] = [];
  for (const ref of refs) {
    if (!isIndexFile(ref.path)) continue;
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
    body: body.trim().replace(/\s+/g, " ").slice(0, MAX_BODY_CHARS),
  };
}

export async function buildOkfSystemPrompt(root: string, selectedBundleIds: string[]): Promise<string> {
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot || selectedBundleIds.length === 0) return "";

  const refs = (await listMarkdown(normalizedRoot)).filter((ref) => !isLogFile(ref.path));
  if (refs.length === 0) return "";

  const sections: string[] = [
    "The following Open Knowledge Format (OKF) knowledge bundles are active. Treat them as curated domain context. Prefer their definitions, relationships, and documented procedures when answering domain questions. If a relevant concept may exist but is not included below, use Drive tools or semantic search when available before guessing.",
  ];

  for (const bundleId of selectedBundleIds) {
    const bundleRefs = refs.filter((ref) => refInBundle(ref.path, bundleId)).slice(0, MAX_DOCS_PER_BUNDLE);
    if (bundleRefs.length === 0) continue;

    const docs = (await Promise.all(bundleRefs.map(toDocument))).filter((doc): doc is OkfDocument => doc !== null);
    if (docs.length === 0) continue;

    const lines = docs.map((doc) => {
      const tags = doc.tags.length > 0 ? ` tags=${doc.tags.join(",")}` : "";
      const description = doc.description ? ` - ${doc.description}` : "";
      const body = doc.body ? `\n  Excerpt: ${doc.body}` : "";
      return `- [${doc.type}] ${doc.title} (${doc.path})${tags}${description}${body}`;
    });
    sections.push(`\n## OKF bundle: ${bundleId || rootBasename(normalizedRoot)}\n${lines.join("\n")}`);
  }

  return sections.length > 1 ? sections.join("\n") : "";
}
