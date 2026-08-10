import yaml from "js-yaml";
import {
  createFileBinary,
  deleteFile,
  ensureSubFolder,
  listFiles,
  renameFile,
} from "./google-drive.server";
import { validateMcpServerUrl } from "./url-validator.server";
import type { AgentPluginConfig, McpServerConfig } from "~/types/settings";

export const AGENT_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGIN_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
export const AGENT_PLUGINS_FOLDER = "agent-plugins";

const GITHUB_API = "https://api.github.com";
const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 10;
const PLUGIN_NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SKILL_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MANIFEST_FIELDS = new Set(["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"]);

export class AgentPluginClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPluginClientError";
  }
}

export interface AgentPluginManifest {
  $schema: typeof AGENT_PLUGIN_SCHEMA;
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  extensions?: Record<string, Record<string, unknown>>;
}

export interface AgentPluginSkillSummary {
  name: string;
  description: string;
  path: string;
}

export interface AgentPluginPackageFile {
  path: string;
  bytes: Uint8Array;
}

export interface AgentPluginCacheFile {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  content: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

export interface AgentPluginPreview {
  manifest: AgentPluginManifest;
  repo: string;
  version: string;
  sourceType: "release" | "branch";
  sourceRef: string;
  commitSha: string;
  skills: AgentPluginSkillSummary[];
  mcpServers: McpServerConfig[];
  warnings: string[];
  files: AgentPluginPackageFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectOptionalString(raw: Record<string, unknown>, field: string): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AgentPluginClientError(`plugin.json: "${field}" must be a string`);
  return value;
}

export function parseAgentPluginManifest(content: string): { manifest: AgentPluginManifest; warnings: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new AgentPluginClientError("plugin.json must be valid JSON"); }
  if (!isRecord(parsed)) throw new AgentPluginClientError("plugin.json must contain an object");
  if (parsed.$schema !== AGENT_PLUGIN_SCHEMA) throw new AgentPluginClientError(`Unsupported Agent Plugins schema: ${String(parsed.$schema ?? "missing")}`);
  if (typeof parsed.name !== "string" || parsed.name.length < 1 || parsed.name.length > 64 || !PLUGIN_NAME_RE.test(parsed.name)) {
    throw new AgentPluginClientError("plugin.json: invalid name");
  }
  const warnings = Object.keys(parsed).filter((key) => !MANIFEST_FIELDS.has(key)).map((key) => `Ignored unknown plugin.json field: ${key}`);
  let extensions: Record<string, Record<string, unknown>> | undefined;
  if (parsed.extensions !== undefined) {
    if (!isRecord(parsed.extensions)) warnings.push("Ignored non-object plugin.json extensions field");
    else {
      extensions = {};
      for (const [key, value] of Object.entries(parsed.extensions)) {
        if (!isRecord(value)) throw new AgentPluginClientError(`plugin.json: extension "${key}" must be an object`);
        extensions[key] = value;
      }
    }
  }
  let author: AgentPluginManifest["author"];
  if (parsed.author !== undefined) {
    if (!isRecord(parsed.author) || Object.keys(parsed.author).some((key) => !["name", "email", "url"].includes(key))) {
      throw new AgentPluginClientError("plugin.json: author must be a closed object");
    }
    author = {};
    for (const key of ["name", "email", "url"] as const) {
      const value = parsed.author[key];
      if (value !== undefined && typeof value !== "string") throw new AgentPluginClientError(`plugin.json: author.${key} must be a string`);
      if (typeof value === "string") author[key] = value;
    }
  }
  let keywords: string[] | undefined;
  if (parsed.keywords !== undefined) {
    if (!Array.isArray(parsed.keywords) || !parsed.keywords.every((v) => typeof v === "string")) throw new AgentPluginClientError("plugin.json: keywords must be an array of strings");
    keywords = parsed.keywords;
  }
  return { manifest: {
    $schema: AGENT_PLUGIN_SCHEMA,
    name: parsed.name,
    version: expectOptionalString(parsed, "version"),
    description: expectOptionalString(parsed, "description"),
    author,
    homepage: expectOptionalString(parsed, "homepage"),
    repository: expectOptionalString(parsed, "repository"),
    license: expectOptionalString(parsed, "license"),
    keywords,
    extensions,
  }, warnings };
}

export function validateAgentSkill(content: string, directoryName: string): AgentPluginSkillSummary {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new AgentPluginClientError("SKILL.md must contain YAML frontmatter");
  let frontmatter: unknown;
  try { frontmatter = yaml.load(match[1]); } catch { throw new AgentPluginClientError("SKILL.md frontmatter must be valid YAML"); }
  if (!isRecord(frontmatter)) throw new AgentPluginClientError("SKILL.md frontmatter must be an object");
  const name = frontmatter.name;
  const description = frontmatter.description;
  if (typeof name !== "string" || name !== directoryName || name.length > 64 || !SKILL_NAME_RE.test(name)) throw new AgentPluginClientError("SKILL.md name must match its directory and follow Agent Skills naming rules");
  if (typeof description !== "string" || description.length < 1 || description.length > 1024) throw new AgentPluginClientError("SKILL.md description must contain 1-1024 characters");
  if (frontmatter.compatibility !== undefined && (typeof frontmatter.compatibility !== "string" || frontmatter.compatibility.length < 1 || frontmatter.compatibility.length > 500)) throw new AgentPluginClientError("SKILL.md compatibility must contain 1-500 characters");
  if (frontmatter.metadata !== undefined && (!isRecord(frontmatter.metadata) || !Object.values(frontmatter.metadata).every((v) => typeof v === "string"))) throw new AgentPluginClientError("SKILL.md metadata values must be strings");
  if (frontmatter["allowed-tools"] !== undefined && typeof frontmatter["allowed-tools"] !== "string") throw new AgentPluginClientError("SKILL.md allowed-tools must be a string");
  if (frontmatter.license !== undefined && typeof frontmatter.license !== "string") throw new AgentPluginClientError("SKILL.md license must be a string");
  return { name, description, path: `skills/${directoryName}/SKILL.md` };
}

function validateHeaders(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Object.values(value).every((v) => typeof v === "string")) throw new AgentPluginClientError(`${label}: headers must contain only string values`);
  const names = Object.keys(value);
  if (names.some((name) => !name) || new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    throw new AgentPluginClientError(`${label}: header names must be non-empty and unique ignoring case`);
  }
  return value as Record<string, string>;
}

function stableMcpId(pluginName: string, serverName: string): string {
  let hash = 2166136261;
  for (const char of `${pluginName}\0${serverName}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const readable = `${pluginName}_${serverName}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 36);
  return `agent_plugin_${readable || "server"}_${(hash >>> 0).toString(36)}`;
}

export function parseAgentPluginMcp(content: string, pluginName: string): { servers: McpServerConfig[]; warnings: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new AgentPluginClientError("mcp.json must be valid JSON"); }
  if (!isRecord(parsed) || parsed.$schema !== AGENT_PLUGIN_MCP_SCHEMA || !isRecord(parsed.mcpServers) || Object.keys(parsed).some((k) => !["$schema", "mcpServers"].includes(k))) {
    throw new AgentPluginClientError("mcp.json does not conform to the Agent Plugins v1.0.0 top-level schema");
  }
  const servers: McpServerConfig[] = [];
  const warnings: string[] = [];
  for (const [serverName, value] of Object.entries(parsed.mcpServers)) {
    const label = `mcp.json server "${serverName}"`;
    if (!isRecord(value) || typeof value.type !== "string") { warnings.push(`${label} is invalid and was skipped`); continue; }
    if (value.type === "stdio" || value.type === "sse") { warnings.push(`${label} uses unsupported transport ${value.type} and was skipped`); continue; }
    if (value.type !== "streamable-http" || Object.keys(value).some((k) => !["type", "url", "headers"].includes(k)) || typeof value.url !== "string") {
      warnings.push(`${label} is invalid and was skipped`); continue;
    }
    try {
      validateMcpServerUrl(value.url);
      const url = new URL(value.url);
      const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
      if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("URL violates Agent Plugins remote endpoint rules");
      servers.push({
        id: stableMcpId(pluginName, serverName),
        name: `${pluginName}: ${serverName}`,
        url: value.url,
        headers: validateHeaders(value.headers, label),
        agentPlugin: { pluginName, serverName },
      });
    } catch (error) {
      warnings.push(`${label} was skipped: ${error instanceof Error ? error.message : "invalid URL"}`);
    }
  }
  return { servers, warnings };
}

interface GitHubTreeItem { path?: string; type?: string; mode?: string; size?: number }

export interface AgentPluginSource {
  sourceType: "release" | "branch";
  sourceRef: string;
  commitSha: string;
}

interface FetchAgentPluginOptions {
  source?: AgentPluginSource;
  includeAllFiles?: boolean;
}

function githubHeaders(): Record<string, string> {
  const token = (process.env.AGENT_PLUGINS_GITHUB_TOKEN || process.env.GITHUB_TOKEN)?.trim();
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "GemiHub-Agent-Plugins",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(url: string, allow404 = false): Promise<T | null> {
  const response = await fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(30_000) });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
      const reset = Number.isFinite(resetSeconds) ? ` Reset: ${new Date(resetSeconds * 1000).toISOString()}.` : "";
      throw new AgentPluginClientError(`GitHub API rate limit exceeded.${reset} Configure AGENT_PLUGINS_GITHUB_TOKEN on the server to raise the limit.`);
    }
    throw new Error(`GitHub request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

async function resolveSource(repo: string): Promise<{ sourceType: "release" | "branch"; sourceRef: string; commitSha: string }> {
  const release = await githubJson<{ tag_name?: string }>(`${GITHUB_API}/repos/${repo}/releases/latest`, true);
  const repository = await githubJson<{ default_branch?: string }>(`${GITHUB_API}/repos/${repo}`);
  const sourceType = release?.tag_name ? "release" as const : "branch" as const;
  const sourceRef = release?.tag_name || repository?.default_branch || "main";
  const commit = await githubJson<{ sha?: string }>(`${GITHUB_API}/repos/${repo}/commits/${encodeURIComponent(sourceRef)}`);
  if (!commit?.sha) throw new Error("GitHub did not return a commit SHA");
  return { sourceType, sourceRef, commitSha: commit.sha };
}

function validatePackagePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new AgentPluginClientError(`Unsafe package path: ${path}`);
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AgentPluginClientError(`${label} must be valid UTF-8`);
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function fetchAgentPlugin(repo: string, options: FetchAgentPluginOptions = {}): Promise<AgentPluginPreview> {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(repo)) throw new AgentPluginClientError("Invalid repo format. Use owner/repo");
  const source = options.source ?? await resolveSource(repo);
  if (!/^[0-9a-f]{40}$/i.test(source.commitSha)) throw new AgentPluginClientError("Invalid pinned GitHub commit SHA");
  const tree = await githubJson<{ tree?: GitHubTreeItem[]; truncated?: boolean }>(`${GITHUB_API}/repos/${repo}/git/trees/${source.commitSha}?recursive=1`);
  if (!tree?.tree || tree.truncated) throw new AgentPluginClientError("GitHub package tree is missing or truncated");
  const entries = tree.tree.filter((entry): entry is Required<Pick<GitHubTreeItem, "path">> & GitHubTreeItem => entry.type === "blob" && typeof entry.path === "string");
  if (entries.length > MAX_FILES) throw new AgentPluginClientError(`Package exceeds ${MAX_FILES} files`);
  let total = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    validatePackagePath(entry.path);
    if (entry.mode === "120000") throw new AgentPluginClientError(`Symbolic links are not allowed: ${entry.path}`);
    if (seen.has(entry.path)) throw new AgentPluginClientError(`Duplicate package path: ${entry.path}`);
    seen.add(entry.path);
    const size = entry.size ?? 0;
    if (size > MAX_FILE_BYTES) throw new AgentPluginClientError(`Package file is too large: ${entry.path}`);
    total += size;
  }
  if (total > MAX_PACKAGE_BYTES) throw new AgentPluginClientError("Package exceeds 50 MiB");
  if (!seen.has("plugin.json")) throw new AgentPluginClientError("Agent Plugin requires plugin.json at the repository root");
  const downloadEntries = options.includeAllFiles === false
    ? entries.filter((entry) => entry.path === "plugin.json" || entry.path === "mcp.json" || /^skills\/[^/]+\/SKILL\.md$/.test(entry.path))
    : entries;
  const files = await mapWithConcurrency(downloadEntries, DOWNLOAD_CONCURRENCY, async (entry) => {
    const encodedPath = entry.path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/${source.commitSha}/${encodedPath}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Failed to download ${entry.path} (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) throw new AgentPluginClientError(`Package file is too large: ${entry.path}`);
    return { path: entry.path, bytes };
  });
  const downloadedBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (downloadedBytes > MAX_PACKAGE_BYTES) throw new AgentPluginClientError("Package exceeds 50 MiB");
  const byPath = new Map(files.map((file) => [file.path, file]));
  const manifestResult = parseAgentPluginManifest(decodeUtf8(byPath.get("plugin.json")!.bytes, "plugin.json"));
  const warnings = [...manifestResult.warnings];
  const skills: AgentPluginSkillSummary[] = [];
  for (const file of files.filter((item) => /^skills\/[^/]+\/SKILL\.md$/.test(item.path))) {
    const directoryName = file.path.split("/")[1];
    try { skills.push(validateAgentSkill(decodeUtf8(file.bytes, file.path), directoryName)); }
    catch (error) { warnings.push(`${file.path} was skipped: ${error instanceof Error ? error.message : "invalid skill"}`); }
  }
  let mcpServers: McpServerConfig[] = [];
  const mcpFile = byPath.get("mcp.json");
  if (mcpFile) {
    try { const result = parseAgentPluginMcp(decodeUtf8(mcpFile.bytes, "mcp.json"), manifestResult.manifest.name); mcpServers = result.servers; warnings.push(...result.warnings); }
    catch (error) { warnings.push(`MCP component disabled: ${error instanceof Error ? error.message : "invalid mcp.json"}`); }
  }
  return { ...source, repo, manifest: manifestResult.manifest, version: manifestResult.manifest.version || source.sourceRef, skills, mcpServers, warnings, files };
}

function mimeForPath(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "application/yaml";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  return "application/octet-stream";
}

async function writePackageFiles(accessToken: string, rootFolderId: string, pluginName: string, files: AgentPluginPackageFile[]): Promise<AgentPluginCacheFile[]> {
  const folders = new Map<string, string>([["", rootFolderId]]);
  const cached: AgentPluginCacheFile[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split("/");
    const name = parts.pop()!;
    let currentPath = "";
    let parentId = rootFolderId;
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folderId = folders.get(currentPath);
      if (!folderId) { folderId = await ensureSubFolder(accessToken, parentId, part); folders.set(currentPath, folderId); }
      parentId = folderId;
    }
    const mimeType = mimeForPath(file.path);
    const driveFile = await createFileBinary(accessToken, name, Buffer.from(file.bytes), parentId, mimeType);
    if (mimeType !== "application/octet-stream") {
      cached.push({
        id: driveFile.id,
        name: driveFile.name,
        path: `${AGENT_PLUGINS_FOLDER}/${pluginName}/${file.path}`,
        mimeType,
        content: new TextDecoder().decode(file.bytes),
        md5Checksum: driveFile.md5Checksum,
        modifiedTime: driveFile.modifiedTime,
      });
    }
  }
  return cached;
}

async function deleteFolderContents(accessToken: string, folderId: string): Promise<void> {
  const children = await listFiles(accessToken, folderId);
  for (const child of children) {
    if (child.mimeType === "application/vnd.google-apps.folder") await deleteFolderContents(accessToken, child.id);
    await deleteFile(accessToken, child.id);
  }
}

async function cleanupInterruptedInstalls(accessToken: string, parentId: string, pluginName: string): Promise<void> {
  const children = await listFiles(accessToken, parentId);
  const stagingPrefix = `.staging-${pluginName}-`;
  const backupPrefix = `.backup-${pluginName}-`;
  const staging = children.filter((child) => child.mimeType === "application/vnd.google-apps.folder" && child.name.startsWith(stagingPrefix));
  for (const folder of staging) { await deleteFolderContents(accessToken, folder.id); await deleteFile(accessToken, folder.id); }

  const remaining = await listFiles(accessToken, parentId);
  const live = remaining.find((child) => child.mimeType === "application/vnd.google-apps.folder" && child.name === pluginName);
  const backups = remaining.filter((child) => child.mimeType === "application/vnd.google-apps.folder" && child.name.startsWith(backupPrefix));
  if (!live && backups.length > 0) await renameFile(accessToken, backups.shift()!.id, pluginName);
  for (const folder of backups) { await deleteFolderContents(accessToken, folder.id); await deleteFile(accessToken, folder.id); }
}

export function filterInstallablePackageFiles(preview: Pick<AgentPluginPreview, "files" | "skills">): AgentPluginPackageFile[] {
  const validSkills = new Set(preview.skills.map((skill) => skill.name));
  return preview.files.filter((file) => {
    const match = file.path.match(/^skills\/([^/]+)\//);
    return !match || validSkills.has(match[1]);
  });
}

export async function installAgentPluginPackage(accessToken: string, rootFolderId: string, preview: AgentPluginPreview): Promise<{ config: AgentPluginConfig; cacheFiles: AgentPluginCacheFile[] }> {
  const parentId = await ensureSubFolder(accessToken, rootFolderId, AGENT_PLUGINS_FOLDER);
  await cleanupInterruptedInstalls(accessToken, parentId, preview.manifest.name);
  const stagingName = `.staging-${preview.manifest.name}-${crypto.randomUUID()}`;
  const stagingId = await ensureSubFolder(accessToken, parentId, stagingName);
  let oldFolder: { id: string } | undefined;
  let cacheFiles: AgentPluginCacheFile[] = [];
  let promoted = false;
  try {
    const installableFiles = filterInstallablePackageFiles(preview);
    cacheFiles = await writePackageFiles(accessToken, stagingId, preview.manifest.name, installableFiles);
    const children = await listFiles(accessToken, parentId);
    const old = children.find((child) => child.name === preview.manifest.name && child.mimeType === "application/vnd.google-apps.folder");
    if (old) {
      oldFolder = old;
      await renameFile(accessToken, old.id, `.backup-${preview.manifest.name}-${crypto.randomUUID()}`);
    }
    await renameFile(accessToken, stagingId, preview.manifest.name);
    promoted = true;
  } catch (error) {
    if (!promoted) {
      try { await deleteFolderContents(accessToken, stagingId); await deleteFile(accessToken, stagingId); } catch { /* best effort */ }
      if (oldFolder) try { await renameFile(accessToken, oldFolder.id, preview.manifest.name); } catch { /* best effort */ }
    }
    throw error;
  }
  if (oldFolder) {
    try { await deleteFolderContents(accessToken, oldFolder.id); await deleteFile(accessToken, oldFolder.id); } catch { /* recovered by the next install GC */ }
  }
  return {
    config: { name: preview.manifest.name, repo: preview.repo, version: preview.version, sourceType: preview.sourceType, sourceRef: preview.sourceRef, commitSha: preview.commitSha, enabled: true, skillNames: preview.skills.map((skill) => skill.name) },
    cacheFiles,
  };
}

export async function uninstallAgentPluginPackage(accessToken: string, rootFolderId: string, pluginName: string): Promise<void> {
  const roots = await listFiles(accessToken, rootFolderId);
  const parent = roots.find((file) => file.name === AGENT_PLUGINS_FOLDER && file.mimeType === "application/vnd.google-apps.folder");
  if (!parent) return;
  const packages = await listFiles(accessToken, parent.id);
  const folder = packages.find((file) => file.name === pluginName && file.mimeType === "application/vnd.google-apps.folder");
  if (!folder) return;
  await deleteFolderContents(accessToken, folder.id);
  await deleteFile(accessToken, folder.id);
}

export function mergeAgentPluginMcpServers(existing: McpServerConfig[], preview: AgentPluginPreview): McpServerConfig[] {
  const previous = new Map(existing.filter((server) => server.agentPlugin?.pluginName === preview.manifest.name).map((server) => [server.agentPlugin!.serverName, server]));
  const retained = existing.filter((server) => server.agentPlugin?.pluginName !== preview.manifest.name);
  const imported = preview.mcpServers.map((server) => {
    const old = previous.get(server.agentPlugin!.serverName);
    return { ...server, tools: old?.tools, oauth: old?.oauth, oauthTokens: old?.oauthTokens };
  });
  return [...retained, ...imported];
}
