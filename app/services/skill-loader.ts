/**
 * Client-side skill loader.
 * Discovers skills from the cached file tree and loads their content
 * from IndexedDB cache.
 */
import yaml from "js-yaml";
import {
  getCachedFileTree,
  getCachedFile,
  getCachedRemoteMeta,
  type CachedTreeNode,
} from "./indexeddb-cache";
import { buildTreeFromMeta } from "~/utils/file-tree-operations";
import type {
  SkillMetadata,
  SkillWorkflowRef,
  LoadedSkill,
} from "~/types/skill";
import { SKILLS_FOLDER_NAME } from "~/types/settings";
import { fixMarkdownBullets } from "~/utils/yaml-helpers";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

interface SkillFrontmatter {
  name?: string;
  description?: string;
  workflows?: Array<{
    path: string;
    name?: string;
    description?: string;
    inputVariables?: string[];
  }>;
}

export function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const m = content.match(FM_RE);
  if (!m) return { frontmatter: {}, body: content };
  try {
    const parsed = yaml.load(fixMarkdownBullets(m[1]));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        frontmatter: parsed as SkillFrontmatter,
        body: content.slice(m[0].length),
      };
    }
  } catch {
    // invalid YAML
  }
  return { frontmatter: {}, body: content };
}

function findChildByName(
  children: CachedTreeNode[],
  name: string,
): CachedTreeNode | undefined {
  return children.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );
}

const SKILL_CAPABILITIES_FENCE_TAG = "skill-capabilities";
// Match `\n` and `\r\n` so SKILL.md files authored on Windows resolve their
// capabilities block (parseFrontmatter already tolerates CRLF; this matches).
const CAPABILITIES_FENCE_RE = new RegExp(
  `^\`\`\`${SKILL_CAPABILITIES_FENCE_TAG}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`[ \\t]*$`,
  "m",
);

/**
 * Extract the embedded `skill-capabilities` YAML fence from SKILL.md's body.
 * The fence is the single source of truth for a skill's workflow definitions;
 * frontmatter holds only user-facing metadata (name, description). Returns
 * null when the block is absent or not valid YAML.
 */
export function extractCapabilitiesBlock(body: string): Record<string, unknown> | null {
  const match = body.match(CAPABILITIES_FENCE_RE);
  if (!match) return null;
  try {
    const parsed = yaml.load(fixMarkdownBullets(match[1]));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Replace (or insert) the ```skill-capabilities fenced YAML block inside a
 * SKILL.md body, preserving any prose around it. When no existing block is
 * found the new one is prepended so the LLM sees capabilities before the
 * instructions prose.
 */
export function upsertCapabilitiesBlock(body: string, capabilities: Record<string, unknown>): string {
  const yamlContent = yaml.dump(capabilities, { lineWidth: -1, noRefs: true }).trimEnd();
  const newBlock = `\`\`\`${SKILL_CAPABILITIES_FENCE_TAG}\n${yamlContent}\n\`\`\``;
  if (CAPABILITIES_FENCE_RE.test(body)) {
    return body.replace(CAPABILITIES_FENCE_RE, newBlock);
  }
  const trimmed = body.replace(/^\s+/, "");
  return trimmed ? `${newBlock}\n\n${trimmed}` : `${newBlock}\n`;
}

/** Serialize a SKILL.md file from frontmatter + body. */
export function writeSkillMd(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterYaml = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${frontmatterYaml}\n---\n\n${body.replace(/^\s+/, "")}`;
}

// Per-session dedup so legacy-format warnings don't spam on every discovery.
const WARNED_SKILL_IDS = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (WARNED_SKILL_IDS.has(key)) return;
  WARNED_SKILL_IDS.add(key);
  console.warn(message);
}

/**
 * Discover skills from the cached file tree.
 *
 * For each skill the single source of truth is the `skill-capabilities`
 * fenced YAML block inside SKILL.md. Frontmatter carries only user-facing
 * metadata (name, description). If a skill still declares `workflows:` in
 * frontmatter (legacy format), it is accepted for backward compatibility
 * with a one-time console warning suggesting migration.
 *
 * Expected layout:
 * ```markdown
 * ---
 * name: my-skill
 * description: ...
 * ---
 *
 * ```skill-capabilities
 * workflows:
 *   - path: workflows/do-x.yaml
 *     description: ...
 *     inputVariables: [filePath, mode]
 * ```
 *
 * <prose body>
 * ```
 */
export async function discoverSkills(): Promise<SkillMetadata[]> {
  let tree = await getCachedFileTree();
  if (!tree) {
    const remoteMeta = await getCachedRemoteMeta();
    if (!remoteMeta) return [];
    const items = buildTreeFromMeta(remoteMeta);
    tree = { id: "current", rootFolderId: remoteMeta.rootFolderId, items, cachedAt: Date.now() };
  }

  const skillsFolder = findChildByName(tree.items, SKILLS_FOLDER_NAME);
  if (!skillsFolder || !skillsFolder.isFolder || !skillsFolder.children) return [];

  const results: SkillMetadata[] = [];

  for (const subFolder of skillsFolder.children) {
    if (!subFolder.isFolder || !subFolder.children) continue;

    const skillMdNode = findChildByName(subFolder.children, "SKILL.md");
    if (!skillMdNode) continue;

    const cached = await getCachedFile(skillMdNode.id);
    if (!cached) continue;

    const { frontmatter, body } = parseFrontmatter(cached.content);
    const skillLabel = frontmatter.name || subFolder.name;

    let capabilities = extractCapabilitiesBlock(body);
    if (!capabilities && Array.isArray(frontmatter.workflows)) {
      warnOnce(skillMdNode.id, `[skills] ${skillLabel}: declares workflows in frontmatter — please migrate to a \`\`\`skill-capabilities fenced block in SKILL.md body. Falling back to the frontmatter declaration for now.`);
      capabilities = { workflows: frontmatter.workflows };
    }

    const workflows: SkillWorkflowRef[] = [];
    const rawWorkflows = (capabilities?.workflows ?? []) as Array<Record<string, unknown>>;
    if (Array.isArray(rawWorkflows)) {
      for (const wf of rawWorkflows) {
        if (!wf || typeof wf.path !== "string") {
          console.warn(`[skills] ${skillLabel}: workflow entry missing "path" — skipped.`);
          continue;
        }
        const fileId = resolveWorkflowFileId(subFolder.children, wf.path);
        if (!fileId) {
          console.warn(`[skills] ${skillLabel}: workflow file not found at "${wf.path}".`);
        }
        const inputVariables = Array.isArray(wf.inputVariables)
          ? (wf.inputVariables as unknown[]).filter((v): v is string => typeof v === "string")
          : undefined;
        if (inputVariables === undefined) {
          console.warn(`[skills] ${skillLabel}: workflow "${wf.path}" has no "inputVariables" declared — the LLM will not know what to pass.`);
        }
        workflows.push({
          path: wf.path,
          name: typeof wf.name === "string" ? wf.name : undefined,
          description: typeof wf.description === "string" ? wf.description : "",
          fileId,
          inputVariables,
        });
      }
    }

    results.push({
      id: subFolder.name,
      folderId: subFolder.id,
      skillMdFileId: skillMdNode.id,
      name: skillLabel,
      description: frontmatter.description || "",
      workflows,
    });
  }

  return results;
}

function resolveWorkflowFileId(
  skillFolderChildren: CachedTreeNode[],
  relPath: string,
): string | undefined {
  const parts = relPath.split("/");
  let node: CachedTreeNode | undefined;
  let searchChildren = skillFolderChildren;
  for (const part of parts) {
    node = findChildByName(searchChildren, part);
    if (!node) return undefined;
    searchChildren = node.children || [];
  }
  return node && !node.isFolder ? node.id : undefined;
}

/**
 * Load full skill content (instructions + references). `inputVariables` on
 * each workflow ref already come from frontmatter via `discoverSkills`, so
 * there's no per-workflow content read here.
 */
export async function loadSkill(
  metadata: SkillMetadata,
): Promise<LoadedSkill> {
  const cached = await getCachedFile(metadata.skillMdFileId);
  const { body } = cached
    ? parseFrontmatter(cached.content)
    : { body: "" };

  const tree = await getCachedFileTree();
  const references: string[] = [];
  if (tree) {
    const skillFolder = findNodeById(tree.items, metadata.folderId);
    if (skillFolder?.children) {
      const refsFolder = findChildByName(skillFolder.children, "references");
      if (refsFolder?.isFolder && refsFolder.children) {
        for (const refFile of refsFolder.children) {
          if (refFile.isFolder) continue;
          const refCached = await getCachedFile(refFile.id);
          if (refCached) {
            references.push(refCached.content);
          }
        }
      }
    }
  }

  return {
    ...metadata,
    instructions: body,
    references,
  };
}

function findNodeById(
  nodes: CachedTreeNode[],
  id: string,
): CachedTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Build a system prompt section for active skills.
 */
export function buildSkillSystemPrompt(skills: LoadedSkill[], hubworkAccounts?: Record<string, unknown>): string {
  if (skills.length === 0) return "";

  const sections: string[] = [
    "# Active Agent Skills",
    "",
    "The following agent skills are active. Each skill's detailed instructions, reference materials, and available workflows are documented in its SKILL.md file.",
    "Before answering the user or calling any skill workflow, call `read_drive_file({fileId: \"<SKILL.md fileId>\"})` for every relevant active skill to load its full instructions. Workflow IDs and their input variables are defined inside SKILL.md — you cannot invoke `run_skill_workflow` correctly without reading it first.",
  ];

  for (const skill of skills) {
    sections.push("");
    sections.push(`## Skill: ${skill.name}`);
    if (skill.description) {
      sections.push(skill.description);
    }
    sections.push(`SKILL.md fileId: \`${skill.skillMdFileId}\` — call \`read_drive_file({fileId: "${skill.skillMdFileId}"})\` to load the full instructions and workflow details.`);

    if (skill.id === "webpage-builder" && hubworkAccounts && Object.keys(hubworkAccounts).length > 0) {
      const types = Object.keys(hubworkAccounts);
      sections.push("");
      sections.push("### Configured Account Types (use exact spelling)");
      for (const t of types) {
        sections.push(`- accountType = \`"${t}"\` → auth.require("${t}"), auth.login("${t}"), auth.logout("${t}"), login page: /login/${t}, requireAuth: ${t}`);
      }
    }
  }

  return sections.join("\n");
}

/**
 * Build a stable workflow ID from skill name and workflow ref.
 */
export function buildWorkflowToolId(
  skillId: string,
  wf: SkillWorkflowRef,
): string {
  const wfName = wf.name || wf.path.replace(/^.*\//, "").replace(/\.(yaml|yml)$/, "");
  return `${skillId}/${wfName}`;
}
