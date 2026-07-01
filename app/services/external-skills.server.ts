import { applyPatch, parsePatch, type StructuredPatch } from "diff";
import { findFilesByExactName, readFile } from "~/services/google-drive.server";
import {
  provisionHubworkSkillFiles,
  type ProvisionHubworkSkillFilesResult,
  type SkillFile,
} from "~/services/hubwork-skill-provisioner-core";

export const OFFICIAL_SKILLS_REPO = "takeshy/llm-hub-skills";
const PLUGIN_ID = "gemihub";
const PLUGIN_VERSION = "0.1.0";
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export interface SkillCatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  installedVersion: string | null;
}

interface SourceFile {
  relativePath: string;
  content: string;
}

interface PluginCompatibility {
  id?: string;
  minVersion?: string;
  maxVersion?: string;
}

interface SkillManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  hostPatches?: Record<string, string[]>;
  compatibility?: {
    plugins?: PluginCompatibility[];
  };
  compatiblePlugins?: string[];
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface GitHubTreeItem {
  path?: string;
  type?: string;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isUnsafePath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.startsWith("/") || normalized.split("/").some((part) => part === "." || part === "..");
}

function isSafeSkillId(skillId: string): boolean {
  return skillId.length > 0 && !skillId.includes("/") && !skillId.includes("\\") && !isUnsafePath(skillId);
}

function isSkillFile(path: string): boolean {
  return path.startsWith("skills/") && path.split("/").length >= 3;
}

function isSkillManifestFile(path: string): boolean {
  return /^skills\/[^/]+\/manifest\.json$/.test(path);
}

function parseSemver(version: string): ParsedSemver | null {
  const match = version.trim().match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number.parseInt(a, 10) - Number.parseInt(b, 10);
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return a.localeCompare(b);
  }
  return 0;
}

function compareVersions(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch ||
    comparePrerelease(left.prerelease, right.prerelease)
  );
}

function parseManifest(content: string | undefined): SkillManifest | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SkillManifest
      : null;
  } catch {
    return null;
  }
}

function isPluginCompatible(manifest: SkillManifest | null): boolean {
  if (!manifest) return true;
  const plugins = manifest.compatibility?.plugins;
  if (Array.isArray(plugins) && plugins.length > 0) {
    const entry = plugins.find((plugin) => plugin.id === PLUGIN_ID);
    if (!entry) return false;
    const min = entry.minVersion ? compareVersions(PLUGIN_VERSION, entry.minVersion) : 0;
    if (min === null || min < 0) return false;
    const max = entry.maxVersion ? compareVersions(PLUGIN_VERSION, entry.maxVersion) : 0;
    if (max === null || max > 0) return false;
    return true;
  }
  if (Array.isArray(manifest.compatiblePlugins) && manifest.compatiblePlugins.length > 0) {
    return manifest.compatiblePlugins.includes(PLUGIN_ID);
  }
  return true;
}

async function getDefaultBranch(): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${OFFICIAL_SKILLS_REPO}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch skills repository: ${res.status}`);
  const json = await res.json() as { default_branch?: string };
  return json.default_branch || "main";
}

async function readGitHubTree(accept: (path: string) => boolean): Promise<SourceFile[]> {
  const [owner, repo] = OFFICIAL_SKILLS_REPO.split("/");
  const branch = await getDefaultBranch();
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!treeRes.ok) throw new Error(`Failed to fetch skills tree: ${treeRes.status}`);
  const treeJson = await treeRes.json() as { tree?: GitHubTreeItem[]; truncated?: boolean };
  if (!Array.isArray(treeJson.tree)) throw new Error("GitHub tree response did not include files.");
  if (treeJson.truncated) throw new Error("GitHub tree response was truncated.");

  const paths = treeJson.tree
    .filter((item) => item.type === "blob" && typeof item.path === "string")
    .map((item) => item.path!)
    .filter(accept)
    .sort();

  const files: SourceFile[] = [];
  for (const path of paths) {
    const rawPath = path.split("/").map(encodeURIComponent).join("/");
    const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${rawPath}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!rawRes.ok) throw new Error(`Failed to fetch ${path}: ${rawRes.status}`);
    files.push({
      relativePath: normalizePath(path.slice("skills/".length)),
      content: await rawRes.text(),
    });
  }
  return files;
}

function groupFilesBySkill(files: SourceFile[]): Map<string, SourceFile[]> {
  const grouped = new Map<string, SourceFile[]>();
  for (const file of files) {
    const relativePath = normalizePath(file.relativePath);
    const skillId = relativePath.split("/")[0];
    if (!skillId) continue;
    if (!grouped.has(skillId)) grouped.set(skillId, []);
    grouped.get(skillId)!.push({ ...file, relativePath });
  }
  return grouped;
}

function resolveSkillRelativePath(skillId: string, path: string): string | null {
  if (!isSafeSkillId(skillId) || isUnsafePath(path)) return null;
  const normalized = normalizePath(path);
  if (!normalized || normalized.startsWith(`${skillId}/`)) return null;
  return `${skillId}/${normalized}`;
}

function normalizePatchTargetPath(skillId: string, fileName: string): string | null {
  if (!fileName || fileName === "/dev/null") return null;
  let normalized = normalizePath(fileName);
  if (normalized.startsWith("a/") || normalized.startsWith("b/")) normalized = normalized.slice(2);
  if (normalized.startsWith(`skills/${skillId}/`)) {
    normalized = normalized.slice(`skills/${skillId}/`.length);
  } else if (normalized.startsWith(`${skillId}/`)) {
    normalized = normalized.slice(`${skillId}/`.length);
  }
  return resolveSkillRelativePath(skillId, normalized);
}

function getSafeSkillTargetPath(skillId: string, relativePath: string): string | null {
  if (!isSafeSkillId(skillId) || isUnsafePath(relativePath)) return null;
  const normalizedRelativePath = normalizePath(relativePath);
  if (!normalizedRelativePath.startsWith(`${skillId}/`)) return null;

  const targetPath = normalizePath(`skills/${normalizedRelativePath}`);
  if (!targetPath.startsWith(`skills/${skillId}/`)) return null;
  return targetPath;
}

function applyHostPatches(skillId: string, files: SourceFile[], manifest: SkillManifest): SourceFile[] {
  const patchPaths = manifest.hostPatches?.[PLUGIN_ID] || [];
  if (patchPaths.length === 0) return files;

  const nextFiles = files.map((file) => ({ ...file }));
  for (const patchPath of patchPaths) {
    const patchRelativePath = resolveSkillRelativePath(skillId, patchPath);
    if (!patchRelativePath) throw new Error(`unsafe patch path: ${patchPath}`);
    const patchFile = nextFiles.find((file) => file.relativePath === patchRelativePath);
    if (!patchFile) throw new Error(`patch file not found: ${patchPath}`);

    let patches: StructuredPatch[];
    try {
      patches = parsePatch(patchFile.content);
    } catch (e) {
      throw new Error(`invalid patch file ${patchPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (patches.length === 0) throw new Error(`invalid patch file: ${patchPath}`);

    for (const patch of patches) {
      const fileName = patch.newFileName !== "/dev/null" ? patch.newFileName : patch.oldFileName;
      const targetRelativePath = normalizePatchTargetPath(skillId, fileName);
      if (!targetRelativePath) throw new Error(`unsafe patch target: ${fileName}`);
      const targetIndex = nextFiles.findIndex((file) => file.relativePath === targetRelativePath);
      const source = targetIndex === -1 ? "" : nextFiles[targetIndex].content;
      const patchedContent = applyPatch(source, patch);
      if (patchedContent === false) throw new Error(`failed to apply patch to ${targetRelativePath}`);
      if (patch.newFileName === "/dev/null") {
        if (targetIndex !== -1) nextFiles.splice(targetIndex, 1);
      } else if (targetIndex === -1) {
        nextFiles.push({ relativePath: targetRelativePath, content: patchedContent });
      } else {
        nextFiles[targetIndex] = { ...nextFiles[targetIndex], content: patchedContent };
      }
    }
  }
  return nextFiles;
}

async function getInstalledManifest(
  accessToken: string,
  rootFolderId: string,
  skillId: string,
): Promise<SkillManifest | null> {
  const matches = await findFilesByExactName(accessToken, `skills/${skillId}/manifest.json`, rootFolderId);
  if (matches.length === 0) return null;
  return parseManifest(await readFile(accessToken, matches[0].id));
}

function mimeTypeForPath(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "text/yaml";
  return "text/plain";
}

export async function fetchExternalSkillCatalog(
  accessToken: string,
  rootFolderId: string,
): Promise<SkillCatalogEntry[]> {
  const files = await readGitHubTree(isSkillManifestFile);
  const entries: SkillCatalogEntry[] = [];
  for (const file of files) {
    const id = normalizePath(file.relativePath).split("/")[0];
    if (!isSafeSkillId(id)) continue;
    const manifest = parseManifest(file.content);
    if (!manifest || (manifest.id && manifest.id !== id)) continue;
    if (!manifest.version || !parseSemver(manifest.version)) continue;
    if (!isPluginCompatible(manifest)) continue;
    const installed = await getInstalledManifest(accessToken, rootFolderId, id);
    entries.push({
      id,
      name: manifest.name || id,
      version: manifest.version,
      description: manifest.description || "",
      installedVersion: installed?.version ?? null,
    });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export async function importExternalSkill(
  accessToken: string,
  rootFolderId: string,
  skillId: string,
  force = false,
): Promise<ProvisionHubworkSkillFilesResult & { skipped?: string }> {
  if (!isSafeSkillId(skillId)) throw new Error("Invalid skill id");
  const files = await readGitHubTree(isSkillFile);
  const skillFiles = groupFilesBySkill(files).get(skillId);
  if (!skillFiles || skillFiles.length === 0) throw new Error(`Skill not found: ${skillId}`);
  if (!skillFiles.some((file) => file.relativePath === `${skillId}/SKILL.md`)) {
    throw new Error("SKILL.md not found");
  }

  const manifestFile = skillFiles.find((file) => file.relativePath === `${skillId}/manifest.json`);
  if (!manifestFile) throw new Error("manifest.json required");
  const manifest = parseManifest(manifestFile.content);
  if (!manifest) throw new Error("invalid manifest.json");
  if (manifest.id && manifest.id !== skillId) throw new Error(`manifest id mismatch: ${manifest.id}`);
  if (!manifest.version || !parseSemver(manifest.version)) throw new Error("missing or invalid manifest version");
  if (!isPluginCompatible(manifest)) throw new Error(`not compatible with ${PLUGIN_ID} ${PLUGIN_VERSION}`);

  if (!force) {
    const installed = await getInstalledManifest(accessToken, rootFolderId, skillId);
    if (installed?.version) {
      const cmp = compareVersions(manifest.version, installed.version);
      if (cmp === null) throw new Error("invalid manifest version");
      if (cmp <= 0) {
        return { files: [], isFirstProvision: false, skipped: `installed version ${installed.version} is current` };
      }
    }
  }

  const patchedFiles = applyHostPatches(skillId, skillFiles, manifest);
  const provisionFiles: SkillFile[] = patchedFiles.map((file) => {
    const path = getSafeSkillTargetPath(skillId, file.relativePath);
    if (!path) throw new Error(`unsafe path: ${file.relativePath}`);
    return {
      path,
      content: file.content,
      mimeType: mimeTypeForPath(file.relativePath),
    };
  });

  return provisionHubworkSkillFiles(accessToken, rootFolderId, provisionFiles, true);
}
