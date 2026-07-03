import type { FileListItem } from "~/contexts/EditorContext";

export function isLocalDocumentHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("//")) return false;
  if (/^https?:\/\/wails\.localhost(?::\d+)?\//i.test(href)) return true;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href);
}

export function hrefToLocalTarget(href: string): string {
  if (/^https?:\/\/wails\.localhost(?::\d+)?\//i.test(href)) {
    try {
      const url = new URL(href);
      return decodeURIComponent(`${url.pathname}${url.hash}`);
    } catch {
      return href;
    }
  }
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

export function pathDirName(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex === -1 ? "" : path.slice(0, separatorIndex);
}

function normalizePath(path: string): string {
  const windows = path.includes("\\");
  const separator = windows ? "\\" : "/";
  const normalized = path.replace(/[\\/]+/g, separator);
  const parts: string[] = [];
  for (const part of normalized.split(separator)) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join(separator);
}

function withMarkdownExtension(path: string): string {
  const clean = path.split("#")[0].trim();
  if (!clean) return "";
  return /\.[A-Za-z0-9]+$/.test(clean) ? clean : `${clean}.md`;
}

export function localHrefToPathCandidates(basePath: string, href: string): string[] {
  const target = hrefToLocalTarget(href);
  const [targetPath] = target.split("#");
  const clean = targetPath.trim();
  if (!clean) return [];

  const baseDir = pathDirName(basePath);
  const isAbsolute = clean.startsWith("/") || clean.startsWith("\\");
  const rootTarget = clean.replace(/^[\\/]+/, "");
  const parentDir = pathDirName(baseDir);
  const joined = isAbsolute ? rootTarget : normalizePath(`${baseDir}/${clean}`);
  const absoluteFallbacks = isAbsolute
    ? [
        baseDir ? normalizePath(`${baseDir}/${rootTarget}`) : "",
        parentDir ? normalizePath(`${parentDir}/${rootTarget}`) : "",
      ]
    : [];
  const candidates = [joined, withMarkdownExtension(joined), ...absoluteFallbacks.flatMap((path) => [path, withMarkdownExtension(path)]), clean, withMarkdownExtension(clean)]
    .map(normalizePath)
    .filter(Boolean);

  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

export function localHrefHeading(href: string): string | undefined {
  const target = hrefToLocalTarget(href);
  const hashIndex = target.indexOf("#");
  if (hashIndex < 0) return undefined;
  return target.slice(hashIndex + 1).trim() || undefined;
}

export function resolveLocalHrefFile(
  fileList: FileListItem[],
  basePath: string,
  href: string,
): FileListItem | undefined {
  const candidates = localHrefToPathCandidates(basePath, href).map((path) => path.toLowerCase());
  if (candidates.length === 0) return undefined;
  return fileList.find((file) => {
    const name = file.name.toLowerCase();
    const path = file.path.toLowerCase();
    const nameNoExt = name.replace(/\.md$/i, "");
    const pathNoExt = path.replace(/\.md$/i, "");
    return candidates.some((candidate) => {
      const candidateNoExt = candidate.replace(/\.md$/i, "");
      return (
        path === candidate ||
        pathNoExt === candidateNoExt ||
        name === candidate ||
        nameNoExt === candidateNoExt
      );
    });
  });
}
