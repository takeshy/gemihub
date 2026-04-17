import { provisionHubworkSkillFiles, pickOldestSpreadsheet, type ProvisionHubworkSkillFilesResult, type SkillFile } from "./hubwork-skill-provisioner-core";
import { findFilesByExactNameAndMimeType, deleteFile, type DriveFile } from "./google-drive.server";
import { google } from "googleapis";

const SPREADSHEET_TITLE = "webpage_builder";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

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
  // Run skill file provisioning and spreadsheet ensure in parallel.
  // Both paths are internally idempotent: findOrCreateSpreadsheet looks up
  // existing webpage_builder spreadsheets before creating, so concurrent
  // first-provision calls can't each create their own copy.
  const [result, spreadsheetInfo] = await Promise.all([
    provisionHubworkSkillFiles(accessToken, rootFolderId, SKILL_FILES, force),
    findOrCreateSpreadsheet(accessToken, force),
  ]);

  if (spreadsheetInfo) {
    result.spreadsheetKeptId = spreadsheetInfo.id;
    if (spreadsheetInfo.discardedIds.length > 0) {
      result.discardedSpreadsheetIds = spreadsheetInfo.discardedIds;
    }
    if (spreadsheetInfo.isNew) {
      result.spreadsheetId = spreadsheetInfo.id;
    }
  }

  return result;
}

export { pickOldestSpreadsheet } from "./hubwork-skill-provisioner-core";

async function deleteDuplicateSpreadsheets(accessToken: string, discard: DriveFile[]): Promise<void> {
  await Promise.all(
    discard.map(async (f) => {
      try {
        await deleteFile(accessToken, f.id);
      } catch (err) {
        if (err instanceof Error && err.message.includes("404")) return;
        console.error("[hubwork-skill-provisioner] Failed to delete duplicate spreadsheet:", err);
      }
    })
  );
}

/**
 * Return the singleton webpage_builder spreadsheet ID, creating it only if
 * no existing one is found. Because Sheets has no atomic create-if-absent,
 * concurrent first-provision calls can both pass the pre-check and both
 * create a spreadsheet; after creating we therefore re-check and, if
 * duplicates exist, keep the oldest createdTime and delete the rest. Both
 * racers converge to the same kept ID, so subsequent writes to user
 * settings are idempotent rather than racing last-writer-wins.
 *
 * `isNew` tells the caller whether settings should be updated (only the
 * first-ever provision writes the spreadsheet reference; subsequent self-
 * healing runs must not clobber the user's saved configuration).
 */
async function findOrCreateSpreadsheet(
  accessToken: string,
  force: boolean,
): Promise<{ id: string; isNew: boolean; discardedIds: string[] } | undefined> {
  try {
    const existing = await findFilesByExactNameAndMimeType(accessToken, SPREADSHEET_TITLE, SPREADSHEET_MIME);
    if (existing.length > 0) {
      const { keep, discard } = pickOldestSpreadsheet(existing);
      if (discard.length > 0) {
        await deleteDuplicateSpreadsheets(accessToken, discard);
      }
      return { id: keep.id, isNew: false, discardedIds: discard.map((d) => d.id) };
    }

    if (force) return undefined;

    const createdId = await createSpreadsheet(accessToken);
    if (!createdId) return undefined;

    // Re-check to self-heal duplicates produced by a concurrent racer.
    const after = await findFilesByExactNameAndMimeType(accessToken, SPREADSHEET_TITLE, SPREADSHEET_MIME);
    if (after.length > 1) {
      const { keep, discard } = pickOldestSpreadsheet(after);
      await deleteDuplicateSpreadsheets(accessToken, discard);
      // Only the racer whose spreadsheet survived returns isNew=true so
      // exactly one caller writes the settings entry.
      return { id: keep.id, isNew: keep.id === createdId, discardedIds: discard.map((d) => d.id) };
    }
    return { id: createdId, isNew: true, discardedIds: [] };
  } catch (e) {
    console.error("[hubwork-skill-provisioner] findOrCreateSpreadsheet failed:", e instanceof Error ? e.message : e);
    return undefined;
  }
}

async function createSpreadsheet(accessToken: string): Promise<string | undefined> {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    const res = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: SPREADSHEET_TITLE },
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
