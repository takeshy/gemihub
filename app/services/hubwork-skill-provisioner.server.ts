import { provisionHubworkSkillFiles, type ProvisionHubworkSkillFilesResult, type SkillFile } from "./hubwork-skill-provisioner-core";
import { google } from "googleapis";

// Skill template files embedded as strings
import SKILL_MD from "./hubwork-skill-templates/SKILL.md?raw";
import REF_API from "./hubwork-skill-templates/references/api-reference.md?raw";
import REF_PATTERNS from "./hubwork-skill-templates/references/page-patterns.md?raw";
import REF_SAMPLE_INTERVIEW from "./hubwork-skill-templates/references/sample-interview.md?raw";
import WF_SAVE_FILE from "./hubwork-skill-templates/workflows/save-file.yaml?raw";
import INITIAL_SCHEMA from "./hubwork-skill-templates/initial-schema.md?raw";

const SKILL_FILES: SkillFile[] = [
  { path: "skills/webpage-builder/SKILL.md", content: SKILL_MD, mimeType: "text/markdown" },
  { path: "skills/webpage-builder/references/api-reference.md", content: REF_API, mimeType: "text/markdown" },
  { path: "skills/webpage-builder/references/page-patterns.md", content: REF_PATTERNS, mimeType: "text/markdown" },
  { path: "skills/webpage-builder/references/sample-interview.md", content: REF_SAMPLE_INTERVIEW, mimeType: "text/markdown" },
  { path: "skills/webpage-builder/workflows/save-file.yaml", content: WF_SAVE_FILE, mimeType: "text/plain" },
  { path: "web/__gemihub/schema.md", content: INITIAL_SCHEMA, mimeType: "text/markdown" },
];

/** Sheets to auto-create on first provision */
const AUTO_SHEETS = ["accounts"];

/**
 * Ensure the webpage-builder skill exists in the user's Drive.
 * Files are stored flat in rootFolderId with full path as filename.
 * Idempotent — skips creation if SKILL.md already exists (unless force=true).
 * Always returns file list (with content) for IndexedDB registration.
 * Registers files in _sync-meta.json so they appear in Pull.
 *
 * On first provision, also creates a "webpage_builder" spreadsheet with
 * accounts / tickets / meetings sheets and an "email" header in accounts.
 *
 * @param force — When true, overwrite existing files with the latest templates.
 */
export async function provisionHubworkSkill(
  accessToken: string,
  rootFolderId: string,
  force = false,
): Promise<ProvisionHubworkSkillFilesResult> {
  // Check upfront whether this is a first provision so we can parallelise
  const { findFileByExactName: findFile } = await import("~/services/google-drive.server");
  const skillMdPath = SKILL_FILES[0]?.path;
  const existingSkillMd = skillMdPath ? await findFile(accessToken, skillMdPath, rootFolderId) : null;
  const isFirstProvision = !existingSkillMd && !force;

  // Run skill file provisioning and spreadsheet creation in parallel
  const [result, spreadsheetId] = await Promise.all([
    provisionHubworkSkillFiles(accessToken, rootFolderId, SKILL_FILES, force),
    isFirstProvision ? createSpreadsheet(accessToken) : Promise.resolve(undefined),
  ]);

  if (spreadsheetId) {
    result.spreadsheetId = spreadsheetId;
  }

  return result;
}

async function createSpreadsheet(accessToken: string): Promise<string | undefined> {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    const res = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: "webpage_builder" },
        sheets: AUTO_SHEETS.map((name, index) => ({
          properties: { title: name, index },
        })),
      },
    });
    const spreadsheetId = res.data.spreadsheetId!;

    // Write headers to the accounts sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'accounts'!A1",
      valueInputOption: "RAW",
      requestBody: { values: [["email", "name", "created_at", "logined_at"]] },
    });

    return spreadsheetId;
  } catch (e) {
    console.error("[hubwork-skill-provisioner] Failed to create spreadsheet:", e instanceof Error ? e.message : e);
    return undefined;
  }
}
