/**
 * Client-side skill loader.
 * Discovers skills from the cached file tree and loads their content
 * from IndexedDB cache.
 */
import yaml from "js-yaml";
import {
  getCachedFileTree,
  getCachedFile,
  type CachedTreeNode,
} from "./indexeddb-cache";
import type {
  SkillMetadata,
  SkillWorkflowRef,
  LoadedSkill,
} from "~/types/skill";
import { parseWorkflowContentByName } from "~/engine/parser";
import { fixMarkdownBullets } from "~/utils/yaml-helpers";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

interface SkillFrontmatter {
  name?: string;
  description?: string;
  workflows?: Array<{
    path: string;
    name?: string;
    description?: string;
  }>;
}

function parseFrontmatter(content: string): {
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

/**
 * Discover skills from the cached file tree.
 * Looks for skillsFolderName / * / SKILL.md under the root.
 */
export async function discoverSkills(
  skillsFolderName: string,
): Promise<SkillMetadata[]> {
  const tree = await getCachedFileTree();
  if (!tree) return [];

  const skillsFolder = findChildByName(tree.items, skillsFolderName);
  if (!skillsFolder || !skillsFolder.isFolder || !skillsFolder.children) return [];

  const results: SkillMetadata[] = [];

  for (const subFolder of skillsFolder.children) {
    if (!subFolder.isFolder || !subFolder.children) continue;

    const skillMdNode = findChildByName(subFolder.children, "SKILL.md");
    if (!skillMdNode) continue;

    const cached = await getCachedFile(skillMdNode.id);
    if (!cached) continue;

    const { frontmatter } = parseFrontmatter(cached.content);
    if (!frontmatter.name) continue;

    // Build workflow refs from frontmatter
    const workflows: SkillWorkflowRef[] = [];
    if (Array.isArray(frontmatter.workflows)) {
      for (const wf of frontmatter.workflows) {
        if (wf.path) {
          workflows.push({
            path: wf.path,
            name: wf.name,
            description: wf.description || "",
          });
        }
      }
    }

    // Auto-discover workflows/ subfolder for undeclared workflows
    const workflowsFolder = findChildByName(
      subFolder.children,
      "workflows",
    );
    if (workflowsFolder?.isFolder && workflowsFolder.children) {
      const declaredPaths = new Set(workflows.map((w) => w.path));
      for (const wfFile of workflowsFolder.children) {
        if (wfFile.isFolder) continue;
        const relPath = `workflows/${wfFile.name}`;
        if (!declaredPaths.has(relPath)) {
          const baseName = wfFile.name.replace(/\.(yaml|yml)$/, "");
          workflows.push({
            path: relPath,
            name: baseName,
            description: `Run ${baseName}`,
            fileId: wfFile.id,
          });
        }
      }
    }

    // Resolve fileIds for frontmatter-declared workflows
    if (workflowsFolder?.isFolder && workflowsFolder.children) {
      for (const wf of workflows) {
        if (wf.fileId) continue;
        // path is relative, e.g. "workflows/build.yaml"
        const parts = wf.path.split("/");
        let node: CachedTreeNode | undefined;
        let searchChildren = subFolder.children;
        for (const part of parts) {
          node = findChildByName(searchChildren, part);
          if (!node) break;
          searchChildren = node.children || [];
        }
        if (node && !node.isFolder) {
          wf.fileId = node.id;
        }
      }
    }

    results.push({
      id: subFolder.name,
      folderId: subFolder.id,
      skillMdFileId: skillMdNode.id,
      name: frontmatter.name,
      description: frontmatter.description || "",
      workflows,
    });
  }

  return results;
}

/**
 * Load full skill content (instructions + references).
 */
export async function loadSkill(
  metadata: SkillMetadata,
): Promise<LoadedSkill> {
  // Load SKILL.md body
  const cached = await getCachedFile(metadata.skillMdFileId);
  const { body } = cached
    ? parseFrontmatter(cached.content)
    : { body: "" };

  // Load references
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

  // Extract input variables from workflow files (parallel reads)
  const workflowsWithVars = await Promise.all(
    metadata.workflows.map(async (wf) => {
      if (!wf.fileId) return wf;
      try {
        const wfCached = await getCachedFile(wf.fileId);
        if (wfCached) {
          return { ...wf, inputVariables: extractInputVariables(wfCached.content, wf.name) };
        }
      } catch {
        // Skip unreadable workflow files
      }
      return wf;
    })
  );

  return {
    ...metadata,
    workflows: workflowsWithVars,
    instructions: body,
    references,
  };
}

// Constants for extractInputVariables
const SAVE_PROPERTIES = [
  "saveTo", "saveFileTo", "savePathTo", "saveStatus",
  "saveImageTo", "saveUiTo",
];

const SYSTEM_VARS = new Set([
  "__workflowName__", "__lastModel__", "__date__", "__time__", "__datetime__",
  "_clipboard",
]);

const VAR_PATTERN = /\{\{(\w[\w.[\]]*?)(?::json)?\}\}/g;

/**
 * Extract input variables from a workflow file.
 * Input variables are {{variables}} used in node properties but not initialized
 * by any node (via saveTo, variable/set name, etc.) and not system variables.
 */
function extractInputVariables(workflowContent: string, workflowName?: string): string[] {
  let workflow;
  try {
    workflow = parseWorkflowContentByName(workflowContent, workflowName);
  } catch {
    return [];
  }

  const usedVars = new Set<string>();
  const initializedVars = new Set<string>();

  for (const [, node] of workflow.nodes) {
    // variable/set nodes initialize the variable named in 'name'
    if ((node.type === "variable" || node.type === "set") && node.properties.name) {
      initializedVars.add(node.properties.name);
    }

    // Save properties initialize variables
    for (const prop of SAVE_PROPERTIES) {
      if (node.properties[prop]) {
        initializedVars.add(node.properties[prop]);
      }
    }

    // Scan all property values for {{variable}} references
    for (const value of Object.values(node.properties)) {
      let match;
      VAR_PATTERN.lastIndex = 0;
      while ((match = VAR_PATTERN.exec(String(value))) !== null) {
        const rootVar = match[1].split(/[.[\]]/)[0];
        if (rootVar) usedVars.add(rootVar);
      }
    }
  }

  const inputVars: string[] = [];
  for (const v of usedVars) {
    if (!initializedVars.has(v) && !SYSTEM_VARS.has(v)) {
      inputVars.push(v);
    }
  }

  return inputVars.sort();
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
export function buildSkillSystemPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";

  const sections: string[] = [
    "# Active Agent Skills",
    "",
    "The following agent skills are active. Proactively use the skill's instructions and workflows to fulfill the user's request.",
    "When a workflow lists \"Input variables\", pass them via the variables parameter as a JSON object. Infer values from the user's message when possible. If a required variable cannot be inferred, ask the user before calling the workflow.",
  ];

  for (const skill of skills) {
    sections.push("");
    sections.push(`## Skill: ${skill.name}`);
    if (skill.description) {
      sections.push(skill.description);
    }
    sections.push("");
    sections.push("### Instructions");
    sections.push(skill.instructions);

    if (skill.references.length > 0) {
      sections.push("");
      sections.push("### Reference Materials");
      for (const ref of skill.references) {
        sections.push("---");
        sections.push(ref);
      }
    }

    if (skill.workflows.length > 0) {
      sections.push("");
      sections.push("### Available Workflows");
      sections.push(
        "You can execute these workflows using the `run_skill_workflow` tool.",
      );
      for (const wf of skill.workflows) {
        const wfId = buildWorkflowToolId(skill.id, wf);
        let line = `- **${wfId}**: ${wf.description}`;
        if (wf.inputVariables && wf.inputVariables.length > 0) {
          line += `\n  Input variables: ${wf.inputVariables.join(", ")}`;
        }
        sections.push(line);
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
