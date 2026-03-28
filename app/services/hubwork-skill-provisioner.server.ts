import { findFileByExactName, createFolder, createFile } from "~/services/google-drive.server";

// Skill template files embedded as strings
import SKILL_MD from "./hubwork-skill-templates/SKILL.md?raw";
import REF_API from "./hubwork-skill-templates/references/api-reference.md?raw";
import REF_PATTERNS from "./hubwork-skill-templates/references/page-patterns.md?raw";
import WF_SAVE_PAGE from "./hubwork-skill-templates/workflows/save-page.yaml?raw";
import WF_SAVE_API from "./hubwork-skill-templates/workflows/save-api.yaml?raw";

const SKILLS_FOLDER = "skills";
const SKILL_ID = "hubwork-web";

interface SkillFile {
  path: string; // relative path within skill folder
  content: string;
  mimeType: string;
}

const SKILL_FILES: SkillFile[] = [
  { path: "SKILL.md", content: SKILL_MD, mimeType: "text/markdown" },
  { path: "references/api-reference.md", content: REF_API, mimeType: "text/markdown" },
  { path: "references/page-patterns.md", content: REF_PATTERNS, mimeType: "text/markdown" },
  { path: "workflows/save-page.yaml", content: WF_SAVE_PAGE, mimeType: "text/plain" },
  { path: "workflows/save-api.yaml", content: WF_SAVE_API, mimeType: "text/plain" },
];

/**
 * Ensure the hubwork-web skill exists in the user's Drive.
 * Creates skills/hubwork-web/ with SKILL.md, references, and workflows if missing.
 * Idempotent — skips if SKILL.md already exists.
 */
export async function provisionHubworkSkill(
  accessToken: string,
  rootFolderId: string,
): Promise<void> {
  // Find or create skills/ folder
  let skillsFolder = await findFileByExactName(accessToken, SKILLS_FOLDER, rootFolderId);
  if (!skillsFolder) {
    skillsFolder = await createFolder(accessToken, SKILLS_FOLDER, rootFolderId);
  }

  // Find or create skills/hubwork-web/ folder
  let skillFolder = await findFileByExactName(accessToken, SKILL_ID, skillsFolder.id);
  if (!skillFolder) {
    skillFolder = await createFolder(accessToken, SKILL_ID, skillsFolder.id);
  }

  // Check if SKILL.md already exists (idempotency)
  const existingSkillMd = await findFileByExactName(accessToken, "SKILL.md", skillFolder.id);
  if (existingSkillMd) {
    return; // Already provisioned
  }

  // Create all skill files
  const folderCache = new Map<string, string>();
  folderCache.set("", skillFolder.id);

  for (const file of SKILL_FILES) {
    const parts = file.path.split("/");
    const fileName = parts.pop()!;

    // Ensure parent directories exist
    let parentId = skillFolder.id;
    let dirPath = "";
    for (const dir of parts) {
      dirPath = dirPath ? `${dirPath}/${dir}` : dir;
      if (!folderCache.has(dirPath)) {
        let folder = await findFileByExactName(accessToken, dir, parentId);
        if (!folder) {
          folder = await createFolder(accessToken, dir, parentId);
        }
        folderCache.set(dirPath, folder.id);
      }
      parentId = folderCache.get(dirPath)!;
    }

    await createFile(accessToken, fileName, file.content, parentId, file.mimeType);
  }
}
