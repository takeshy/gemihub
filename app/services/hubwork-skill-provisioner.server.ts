import { findFileByExactName, createFile } from "~/services/google-drive.server";
import { upsertFileInMeta } from "~/services/sync-meta.server";

// Skill template files embedded as strings
import SKILL_MD from "./hubwork-skill-templates/SKILL.md?raw";
import REF_API from "./hubwork-skill-templates/references/api-reference.md?raw";
import REF_PATTERNS from "./hubwork-skill-templates/references/page-patterns.md?raw";
import WF_SAVE_PAGE from "./hubwork-skill-templates/workflows/save-page.yaml?raw";
import WF_SAVE_API from "./hubwork-skill-templates/workflows/save-api.yaml?raw";

interface SkillFile {
  path: string;
  content: string;
  mimeType: string;
}

const SKILL_FILES: SkillFile[] = [
  { path: "skills/hubwork-web/SKILL.md", content: SKILL_MD, mimeType: "text/markdown" },
  { path: "skills/hubwork-web/references/api-reference.md", content: REF_API, mimeType: "text/markdown" },
  { path: "skills/hubwork-web/references/page-patterns.md", content: REF_PATTERNS, mimeType: "text/markdown" },
  { path: "skills/hubwork-web/workflows/save-page.yaml", content: WF_SAVE_PAGE, mimeType: "text/plain" },
  { path: "skills/hubwork-web/workflows/save-api.yaml", content: WF_SAVE_API, mimeType: "text/plain" },
];

export interface ProvisionedFile {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  content: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

/**
 * Ensure the hubwork-web skill exists in the user's Drive.
 * Files are stored flat in rootFolderId with full path as filename.
 * Idempotent — skips creation if SKILL.md already exists.
 * Always returns file list (with content) for IndexedDB registration.
 * Registers files in _sync-meta.json so they appear in Pull.
 */
export async function provisionHubworkSkill(
  accessToken: string,
  rootFolderId: string,
): Promise<ProvisionedFile[]> {
  const skillMdPath = SKILL_FILES[0].path;

  // Check if already provisioned
  const existing = await findFileByExactName(accessToken, skillMdPath, rootFolderId);
  if (existing) {
    // Already provisioned — return all skill files for local cache registration
    return collectExistingFiles(accessToken, rootFolderId);
  }

  // Create all skill files flat in rootFolderId
  const created: ProvisionedFile[] = [];
  for (const file of SKILL_FILES) {
    const driveFile = await createFile(accessToken, file.path, file.content, rootFolderId, file.mimeType);
    await upsertFileInMeta(accessToken, rootFolderId, driveFile);

    created.push({
      id: driveFile.id,
      name: driveFile.name,
      path: file.path,
      mimeType: file.mimeType,
      content: file.content,
      md5Checksum: driveFile.md5Checksum,
      modifiedTime: driveFile.modifiedTime,
    });
  }

  return created;
}

/**
 * Collect existing skill files from Drive for local cache registration.
 */
async function collectExistingFiles(
  accessToken: string,
  rootFolderId: string,
): Promise<ProvisionedFile[]> {
  const result: ProvisionedFile[] = [];

  for (const file of SKILL_FILES) {
    const driveFile = await findFileByExactName(accessToken, file.path, rootFolderId);
    if (driveFile) {
      // Ensure registered in sync-meta
      await upsertFileInMeta(accessToken, rootFolderId, driveFile);

      result.push({
        id: driveFile.id,
        name: driveFile.name,
        path: file.path,
        mimeType: file.mimeType,
        content: file.content, // Use embedded template content (canonical)
        md5Checksum: driveFile.md5Checksum,
        modifiedTime: driveFile.modifiedTime,
      });
    }
  }

  return result;
}
