import { provisionHubworkSkillFiles, pickOldestSpreadsheet, type ProvisionHubworkSkillFilesResult, type SkillFile } from "./hubwork-skill-provisioner-core";
import { findFilesByExactNameAndMimeType, deleteFile, moveFile, getFileMetadata, type DriveFile } from "./google-drive.server";
import { google } from "googleapis";
import type { Language } from "~/types/settings";
import { WEBPAGE_BUILDER_SKILL_RELEASE_DATE, WEBPAGE_BUILDER_SKILL_VERSION, extractSkillVersion } from "./hubwork-skill-version";

const SPREADSHEET_TITLE = "webpage_builder";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

// Skill template files embedded as strings
import SKILL_MD from "./hubwork-skill-templates/SKILL.md?raw";
import SKILL_MANIFEST from "./hubwork-skill-templates/manifest.json?raw";
import SKILL_HISTORY from "./hubwork-skill-templates/history.md?raw";
import REF_API from "./hubwork-skill-templates/references/api-reference.md?raw";
import REF_PATTERNS from "./hubwork-skill-templates/references/page-patterns.md?raw";
import REF_SAMPLE_INTERVIEW from "./hubwork-skill-templates/references/sample-interview.md?raw";
import WORKFLOW_CREATE_ARTICLE from "./hubwork-skill-templates/workflows/create-article.yaml?raw";
import INITIAL_INDEX_HTML_EN from "./hubwork-skill-templates/initial-index.en.html?raw";
import INITIAL_INDEX_HTML_JA from "./hubwork-skill-templates/initial-index.ja.html?raw";

const RESPONSE_LANGUAGE_PLACEHOLDER = "{{RESPONSE_LANGUAGE_INSTRUCTION}}";
const SKILL_VERSION_PLACEHOLDER = "{{SKILL_TEMPLATE_VERSION}}";
const SKILL_DATE_PLACEHOLDER = "{{SKILL_TEMPLATE_DATE}}";

/**
 * Build the response-language directive that is baked into SKILL.md at
 * provision time. The skill ships with English-heavy prose and reference
 * files; without a locale-matched directive at the TOP of SKILL.md, the
 * LLM drifts toward whichever language the reference samples happen to be
 * in. Placing the directive inside the skill file itself (rather than only
 * in the chat system prompt) keeps it adjacent to the references the LLM
 * loads via `read_drive_file`, which is where drift occurs.
 */
function buildResponseLanguageInstruction(language: Language | null | undefined): string {
  if (language === "ja") {
    return [
      "## 応答言語",
      "",
      "**重要: すべての自然言語の出力は日本語で書いてください。** プラン、確認、質問、検証結果、エラー／ステータスメッセージ、およびスキルが管理するファイル（`web/__gemihub/spec.md`、`web/__gemihub/history.md`）を含む、毎ターンのすべての応答に適用されます。コード、ファイルパス、URL パス、識別子、シート名、カラム名などの技術トークンはそのまま維持し、散文のみを翻訳してください。",
    ].join("\n");
  }
  return [
    "## Response Language",
    "",
    "**IMPORTANT: Write all natural-language output in English.** This applies to every turn's output — plans, confirmations, questions, verification results, error/status messages, and skill-managed files (`web/__gemihub/spec.md`, `web/__gemihub/history.md`). Preserve technical tokens such as code, file paths, URL paths, identifiers, sheet names, and column names as-is; translate only the prose. Even if the user writes in another language or the surrounding context (sheet contents, prior files) is in another language, continue responding in English.",
  ].join("\n");
}

function renderSkillMd(template: string, language: Language | null | undefined): string {
  return template.replace(RESPONSE_LANGUAGE_PLACEHOLDER, buildResponseLanguageInstruction(language));
}

function renderSkillManifest(template: string): string {
  return template.replace(SKILL_VERSION_PLACEHOLDER, WEBPAGE_BUILDER_SKILL_VERSION);
}

function renderSkillHistory(template: string): string {
  return template
    .replaceAll(SKILL_VERSION_PLACEHOLDER, WEBPAGE_BUILDER_SKILL_VERSION)
    .replaceAll(SKILL_DATE_PLACEHOLDER, WEBPAGE_BUILDER_SKILL_RELEASE_DATE);
}

/**
 * Language-scoped tokens baked into the blog / announcement workflows at
 * provision time. Workflow YAMLs are raw inputs to the client-side execution
 * engine — unlike chat system prompts, they do not receive the active UI
 * language at runtime. Rendering these placeholders per user locale is what
 * keeps `lang=` attributes, manual-run dialog titles, and the LLM's choice of
 * nav labels aligned with the site's language.
 *
 * Placeholder names are distinct enough that accidentally leaking one through
 * to runtime is visually obvious (the workflow engine leaves unknown
 * `{{...}}` tokens unchanged rather than failing).
 */
interface WorkflowLangTokens {
  LANG_CODE: string;
  LANG_NAME: string;
  UI_PICK_CATEGORY_TITLE: string;
  UI_PICK_NOTE_TITLE: string;
  UI_PUB_DATE_TITLE: string;
  UI_ARTICLE_TITLE_TITLE: string;
}

function buildWorkflowLangTokens(language: Language | null | undefined): WorkflowLangTokens {
  if (language === "ja") {
    return {
      LANG_CODE: "ja",
      LANG_NAME: "Japanese",
      UI_PICK_CATEGORY_TITLE: "カテゴリ (blogs / announcements)",
      UI_PICK_NOTE_TITLE: "公開するnoteを選択してください",
      UI_PUB_DATE_TITLE: "公開日 (YYYY-MM-DD)",
      UI_ARTICLE_TITLE_TITLE: "記事のタイトル",
    };
  }
  return {
    LANG_CODE: "en",
    LANG_NAME: "English",
    UI_PICK_CATEGORY_TITLE: "Category (blogs / announcements)",
    UI_PICK_NOTE_TITLE: "Select a note to publish",
    UI_PUB_DATE_TITLE: "Publish date (YYYY-MM-DD)",
    UI_ARTICLE_TITLE_TITLE: "Article title",
  };
}

function renderWorkflow(template: string, language: Language | null | undefined): string {
  const tokens = buildWorkflowLangTokens(language);
  let out = template;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function buildSkillFiles(language: Language | null | undefined): SkillFile[] {
  return [
    { path: "skills/webpage-builder/SKILL.md", content: renderSkillMd(SKILL_MD, language), mimeType: "text/markdown" },
    { path: "skills/webpage-builder/manifest.json", content: renderSkillManifest(SKILL_MANIFEST), mimeType: "application/json" },
    { path: "skills/webpage-builder/history.md", content: renderSkillHistory(SKILL_HISTORY), mimeType: "text/markdown" },
    { path: "skills/webpage-builder/references/api-reference.md", content: REF_API, mimeType: "text/markdown" },
    { path: "skills/webpage-builder/references/page-patterns.md", content: REF_PATTERNS, mimeType: "text/markdown" },
    { path: "skills/webpage-builder/references/sample-interview.md", content: REF_SAMPLE_INTERVIEW, mimeType: "text/markdown" },
    { path: "skills/webpage-builder/workflows/create-article.yaml", content: renderWorkflow(WORKFLOW_CREATE_ARTICLE, language), mimeType: "text/yaml" },
    // Sample landing page so the user can verify DNS / SSL / custom-domain
    // routing immediately after provision. The webpage-builder skill replaces
    // this page (and creates web/__gemihub/schema.md on demand) once the user
    // starts building. Without an initial file under web/, the Drive folder
    // is empty and the custom domain returns 404, which is hard to debug.
    { path: "web/index.html", content: language === "ja" ? INITIAL_INDEX_HTML_JA : INITIAL_INDEX_HTML_EN, mimeType: "text/html" },
  ];
}

/** Sheets to auto-create on first provision */
const AUTO_SHEETS = ["accounts"];

/**
 * Module-level in-flight cache: concurrent callers for the same
 * rootFolderId + force share the same Promise instead of each running
 * their own findFilesByExactName + createFile sequence. Drive has no
 * atomic create-if-absent, and its list API is eventually consistent, so
 * even with post-create reconciliation two racers can briefly produce
 * extra copies. Within a single process this cache eliminates the race;
 * across instances the reconciliation pass in provisionHubworkSkillFiles
 * still self-heals on the next call.
 */
const inFlight = new Map<string, Promise<ProvisionHubworkSkillFilesResult>>();

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
 * @param language — UI language at provision time, used to bake the response-
 *   language directive into SKILL.md so the activated skill responds in the
 *   user's language instead of drifting with reference-sample locale.
 */
export async function provisionHubworkSkill(
  accessToken: string,
  rootFolderId: string,
  force = false,
  language: Language | null | undefined = "en",
): Promise<ProvisionHubworkSkillFilesResult & { skillVersion?: string }> {
  const langKey = language ?? "en";
  const key = `${rootFolderId}:${force ? "force" : "ensure"}:${langKey}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = runProvision(accessToken, rootFolderId, force, language).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function runProvision(
  accessToken: string,
  rootFolderId: string,
  force: boolean,
  language: Language | null | undefined,
): Promise<ProvisionHubworkSkillFilesResult & { skillVersion?: string }> {
  // Run skill file provisioning and spreadsheet ensure in parallel.
  // Both paths are internally idempotent: findOrCreateSpreadsheet looks up
  // existing webpage_builder spreadsheets before creating, so concurrent
  // first-provision calls can't each create their own copy.
  const [result, spreadsheetInfo] = await Promise.all([
    provisionHubworkSkillFiles(accessToken, rootFolderId, buildSkillFiles(language), force),
    findOrCreateSpreadsheet(accessToken, rootFolderId, force),
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

  const manifest = result.files.find((file) => file.path === "skills/webpage-builder/manifest.json");
  result.skillVersion = manifest ? extractSkillVersion(manifest.content) : undefined;

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
/**
 * Move the spreadsheet into rootFolderId if it isn't already there. Sheets
 * API always creates inside My Drive root, so freshly-created spreadsheets
 * need this; spreadsheets discovered from earlier provisions may be in root
 * (legacy) or already in rootFolderId (current). Idempotent and non-fatal.
 */
async function ensureSpreadsheetInRootFolder(
  accessToken: string,
  spreadsheetId: string,
  rootFolderId: string,
): Promise<void> {
  try {
    const meta = await getFileMetadata(accessToken, spreadsheetId);
    if (meta.parents?.includes(rootFolderId)) return;
    const oldParent = meta.parents?.[0] ?? "root";
    await moveFile(accessToken, spreadsheetId, rootFolderId, oldParent);
  } catch (e) {
    console.error("[hubwork-skill-provisioner] Failed to relocate spreadsheet into gemihub folder:", e instanceof Error ? e.message : e);
  }
}

async function findOrCreateSpreadsheet(
  accessToken: string,
  rootFolderId: string,
  force: boolean,
): Promise<{ id: string; isNew: boolean; discardedIds: string[] } | undefined> {
  try {
    const existing = await findFilesByExactNameAndMimeType(accessToken, SPREADSHEET_TITLE, SPREADSHEET_MIME);
    if (existing.length > 0) {
      const { keep, discard } = pickOldestSpreadsheet(existing);
      if (discard.length > 0) {
        await deleteDuplicateSpreadsheets(accessToken, discard);
      }
      await ensureSpreadsheetInRootFolder(accessToken, keep.id, rootFolderId);
      return { id: keep.id, isNew: false, discardedIds: discard.map((d) => d.id) };
    }

    if (force) return undefined;

    const createdId = await createSpreadsheet(accessToken, rootFolderId);
    if (!createdId) return undefined;

    // Re-check to self-heal duplicates produced by a concurrent racer.
    const after = await findFilesByExactNameAndMimeType(accessToken, SPREADSHEET_TITLE, SPREADSHEET_MIME);
    if (after.length > 1) {
      const { keep, discard } = pickOldestSpreadsheet(after);
      await deleteDuplicateSpreadsheets(accessToken, discard);
      await ensureSpreadsheetInRootFolder(accessToken, keep.id, rootFolderId);
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

async function createSpreadsheet(accessToken: string, rootFolderId: string): Promise<string | undefined> {
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

    // Sheets API creates spreadsheets in My Drive root; relocate into the
    // gemihub folder so the user sees it alongside the rest of their data.
    await ensureSpreadsheetInRootFolder(accessToken, spreadsheetId, rootFolderId);

    return spreadsheetId;
  } catch (e) {
    console.error("[hubwork-skill-provisioner] Failed to create spreadsheet:", e instanceof Error ? e.message : e);
    return undefined;
  }
}
