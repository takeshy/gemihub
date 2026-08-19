/**
 * Built-in GemiHub skills, embedded in the app bundle.
 *
 * These used to be provisioned into the user's Drive under `skills/` so the
 * normal skill loader could find them. That put four app-owned folders in
 * everyone's file tree and made every install carry copies that only the app
 * ever writes. They now live here instead: discovery merges them in, loading
 * reads them straight from the bundle, and nothing touches Drive.
 *
 * Ids are stable and take precedence over a same-named Drive skill, so users
 * who still have the old provisioned copies see one entry, not two.
 *
 * The Markdown, Base, and Canvas skill documentation was initially adapted
 * from kepano/obsidian-skills under the MIT License. The Base guide is now an
 * independent description of GemiHub's compatibility layer. See
 * THIRD_PARTY_NOTICES.md.
 */

import type { LoadedSkill, SkillMetadata } from "~/types/skill";

import MARKDOWN_SKILL_MD from "./gemihub-skill-templates/markdown/SKILL.md?raw";
import MARKDOWN_REF_PREVIEW from "./gemihub-skill-templates/markdown/references/preview.md?raw";
import CANVAS_SKILL_MD from "./gemihub-skill-templates/canvas/SKILL.md?raw";
import CANVAS_REF_EXAMPLES from "./gemihub-skill-templates/canvas/references/examples.md?raw";
import BASE_SKILL_MD from "./gemihub-skill-templates/base/SKILL.md?raw";
import BASE_REF_FUNCTIONS from "./gemihub-skill-templates/base/references/functions.md?raw";
import BASE_REF_VIEWS from "./gemihub-skill-templates/base/references/views.md?raw";
import DASHBOARD_SKILL_MD from "./gemihub-skill-templates/dashboard/SKILL.md?raw";

/** Prefix for the synthetic ids that stand in for Drive file/folder ids. */
const BUILTIN_PREFIX = "builtin:";

interface BuiltinSkillDefinition {
  metadata: SkillMetadata;
  source: string;
  references: string[];
}

function definition(
  id: string,
  description: string,
  source: string,
  references: string[],
): BuiltinSkillDefinition {
  return {
    metadata: {
      id,
      folderId: `${BUILTIN_PREFIX}${id}`,
      skillMdFileId: `${BUILTIN_PREFIX}${id}/SKILL.md`,
      name: id,
      description,
      workflows: [],
    },
    source,
    references,
  };
}

const DEFINITIONS: BuiltinSkillDefinition[] = [
  definition(
    "markdown",
    "Create and edit GemiHub Markdown notes using GFM, frontmatter, callouts, Mermaid diagrams, tables, task lists, and links.",
    MARKDOWN_SKILL_MD,
    [MARKDOWN_REF_PREVIEW],
  ),
  definition(
    "canvas",
    "Create and edit GemiHub .canvas files using JSON Canvas nodes, edges, groups, colors, and file/link references.",
    CANVAS_SKILL_MD,
    [CANVAS_REF_EXAMPLES],
  ),
  definition(
    "base",
    "Author GemiHub .base files: filters, formulas, properties, and table/card views over the note collection.",
    BASE_SKILL_MD,
    [BASE_REF_FUNCTIONS, BASE_REF_VIEWS],
  ),
  // The dashboard skill folds the whole Base guide in as references so it is
  // self-sufficient: activating it alone gives the model everything it needs
  // to author the backing .base files.
  definition(
    "dashboard",
    "Author GemiHub .dashboard files: widget grid, widget types, and the .base files that feed them.",
    DASHBOARD_SKILL_MD,
    [BASE_SKILL_MD, BASE_REF_FUNCTIONS, BASE_REF_VIEWS],
  ),
];

export const BUILTIN_SKILL_IDS: ReadonlySet<string> = new Set(
  DEFINITIONS.map(({ metadata }) => metadata.id),
);

/** True for the synthetic ids this module hands out (never Drive ids). */
export function isBuiltinSkillFileId(fileId: string): boolean {
  return fileId.startsWith(BUILTIN_PREFIX);
}

/** Strip the SKILL.md frontmatter — the loader passes the body to the model. */
function instructionBody(source: string): string {
  const frontmatterEnd = source.indexOf("\n---", 4);
  return frontmatterEnd >= 0
    ? source.slice(frontmatterEnd + 4).replace(/^\s+/, "")
    : source;
}

export function getBuiltinSkills(): SkillMetadata[] {
  return DEFINITIONS.map(({ metadata }) => metadata);
}

export function loadBuiltinSkill(skillId: string): LoadedSkill | null {
  const found = DEFINITIONS.find(({ metadata }) => metadata.id === skillId);
  if (!found) return null;
  return {
    ...found.metadata,
    instructions: instructionBody(found.source),
    references: found.references,
  };
}
