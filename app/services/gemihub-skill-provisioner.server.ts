import {
  provisionHubworkSkillFiles,
  type ProvisionHubworkSkillFilesResult,
  type SkillFile,
} from "./hubwork-skill-provisioner-core";

// The Markdown, Base, and Canvas skill documentation was initially adapted
// from kepano/obsidian-skills under the MIT License. The Base guide is now an
// independent description of GemiHub's compatibility layer. See
// THIRD_PARTY_NOTICES.md.

import MARKDOWN_SKILL_MD from "./gemihub-skill-templates/markdown/SKILL.md?raw";
import MARKDOWN_REF_PREVIEW from "./gemihub-skill-templates/markdown/references/preview.md?raw";
import CANVAS_SKILL_MD from "./gemihub-skill-templates/canvas/SKILL.md?raw";
import CANVAS_REF_EXAMPLES from "./gemihub-skill-templates/canvas/references/examples.md?raw";
import BASE_SKILL_MD from "./gemihub-skill-templates/base/SKILL.md?raw";
import BASE_REF_FUNCTIONS from "./gemihub-skill-templates/base/references/functions.md?raw";
import BASE_REF_VIEWS from "./gemihub-skill-templates/base/references/views.md?raw";
import DASHBOARD_SKILL_MD from "./gemihub-skill-templates/dashboard/SKILL.md?raw";

function buildMarkdownSkillFiles(): SkillFile[] {
  return [
    {
      path: "skills/markdown/SKILL.md",
      content: MARKDOWN_SKILL_MD,
      mimeType: "text/markdown",
    },
    {
      path: "skills/markdown/references/preview.md",
      content: MARKDOWN_REF_PREVIEW,
      mimeType: "text/markdown",
    },
  ];
}

function buildCanvasSkillFiles(): SkillFile[] {
  return [
    {
      path: "skills/canvas/SKILL.md",
      content: CANVAS_SKILL_MD,
      mimeType: "text/markdown",
    },
    {
      path: "skills/canvas/references/examples.md",
      content: CANVAS_REF_EXAMPLES,
      mimeType: "text/markdown",
    },
  ];
}

function buildBaseSkillFiles(): SkillFile[] {
  return [
    {
      path: "skills/base/SKILL.md",
      content: BASE_SKILL_MD,
      mimeType: "text/markdown",
    },
    {
      path: "skills/base/references/functions.md",
      content: BASE_REF_FUNCTIONS,
      mimeType: "text/markdown",
    },
    {
      path: "skills/base/references/views.md",
      content: BASE_REF_VIEWS,
      mimeType: "text/markdown",
    },
  ];
}

function buildDashboardSkillFiles(): SkillFile[] {
  return [
    {
      path: "skills/dashboard/SKILL.md",
      content: DASHBOARD_SKILL_MD,
      mimeType: "text/markdown",
    },
    // Fold the full Base authoring guide in as references so the `dashboard`
    // skill is self-sufficient — activating it alone gives the model everything
    // it needs to author the backing `.base` files. Reuses the same source as
    // the standalone `base` skill (single source of truth).
    {
      path: "skills/dashboard/references/base.md",
      content: BASE_SKILL_MD,
      mimeType: "text/markdown",
    },
    {
      path: "skills/dashboard/references/base-functions.md",
      content: BASE_REF_FUNCTIONS,
      mimeType: "text/markdown",
    },
    {
      path: "skills/dashboard/references/base-views.md",
      content: BASE_REF_VIEWS,
      mimeType: "text/markdown",
    },
  ];
}

const inFlight = new Map<string, Promise<ProvisionHubworkSkillFilesResult>>();

export async function provisionGemihubSkills(
  accessToken: string,
  rootFolderId: string,
  force = false,
): Promise<ProvisionHubworkSkillFilesResult> {
  const key = `${rootFolderId}:${force ? "force" : "ensure"}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const markdown = await provisionHubworkSkillFiles(
      accessToken,
      rootFolderId,
      buildMarkdownSkillFiles(),
      force,
    );
    const canvas = await provisionHubworkSkillFiles(
      accessToken,
      rootFolderId,
      buildCanvasSkillFiles(),
      force,
    );
    const base = await provisionHubworkSkillFiles(
      accessToken,
      rootFolderId,
      buildBaseSkillFiles(),
      force,
    );
    const dashboard = await provisionHubworkSkillFiles(
      accessToken,
      rootFolderId,
      buildDashboardSkillFiles(),
      force,
    );
    return {
      files: [...markdown.files, ...canvas.files, ...base.files, ...dashboard.files],
      isFirstProvision:
        markdown.isFirstProvision ||
        canvas.isFirstProvision ||
        base.isFirstProvision ||
        dashboard.isFirstProvision,
    };
  })().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
