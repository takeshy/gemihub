import {
  provisionHubworkSkillFiles,
  type ProvisionHubworkSkillFilesResult,
  type SkillFile,
} from "./hubwork-skill-provisioner-core";

import MARKDOWN_SKILL_MD from "./gemihub-skill-templates/markdown/SKILL.md?raw";
import MARKDOWN_REF_PREVIEW from "./gemihub-skill-templates/markdown/references/preview.md?raw";
import CANVAS_SKILL_MD from "./gemihub-skill-templates/canvas/SKILL.md?raw";
import CANVAS_REF_EXAMPLES from "./gemihub-skill-templates/canvas/references/examples.md?raw";

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
    return {
      files: [...markdown.files, ...canvas.files],
      isFirstProvision: markdown.isFirstProvision || canvas.isFirstProvision,
    };
  })().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
