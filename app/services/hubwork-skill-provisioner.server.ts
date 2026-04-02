import { provisionHubworkSkillFiles, type ProvisionHubworkSkillFilesResult, type SkillFile } from "./hubwork-skill-provisioner-core";

// Skill template files embedded as strings
import SKILL_MD from "./hubwork-skill-templates/SKILL.md?raw";
import REF_API from "./hubwork-skill-templates/references/api-reference.md?raw";
import REF_PATTERNS from "./hubwork-skill-templates/references/page-patterns.md?raw";
import REF_SAMPLE_INTERVIEW from "./hubwork-skill-templates/references/sample-interview.md?raw";
import WF_SAVE_PAGE from "./hubwork-skill-templates/workflows/save-page.yaml?raw";
import WF_SAVE_API from "./hubwork-skill-templates/workflows/save-api.yaml?raw";

const SKILL_FILES: SkillFile[] = [
  { path: "skills/webpage-builder/SKILL.md", content: SKILL_MD, mimeType: "text/markdown" },
  { path: "skills/webpage-builder/references/api-reference.md", content: REF_API, mimeType: "text/markdown" },
  { path: "skills/webpage-builder/references/page-patterns.md", content: REF_PATTERNS, mimeType: "text/markdown" },
  { path: "skills/webpage-builder/references/sample-interview.md", content: REF_SAMPLE_INTERVIEW, mimeType: "text/markdown" },
  { path: "skills/webpage-builder/workflows/save-page.yaml", content: WF_SAVE_PAGE, mimeType: "text/plain" },
  { path: "skills/webpage-builder/workflows/save-api.yaml", content: WF_SAVE_API, mimeType: "text/plain" },
];

/**
 * Ensure the webpage-builder skill exists in the user's Drive.
 * Files are stored flat in rootFolderId with full path as filename.
 * Idempotent — skips creation if SKILL.md already exists (unless force=true).
 * Always returns file list (with content) for IndexedDB registration.
 * Registers files in _sync-meta.json so they appear in Pull.
 *
 * @param force — When true, overwrite existing files with the latest templates.
 */
export async function provisionHubworkSkill(
  accessToken: string,
  rootFolderId: string,
  force = false,
): Promise<ProvisionHubworkSkillFilesResult> {
  return provisionHubworkSkillFiles(accessToken, rootFolderId, SKILL_FILES, force);
}
