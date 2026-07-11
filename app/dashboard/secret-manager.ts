export interface SecretManagerConfig {
  /** Empty means every .encrypted file in the workspace. */
  folder?: string;
}

export function normalizeSecretFolder(folder: string): string {
  return folder
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

export function secretFilePath(folder: string, inputName: string, directory = ""): string {
  const rawName = inputName.trim().replace(/\.encrypted$/i, "");
  const name = rawName
    .replace(/[\\/:*?"<>|#[\]\n\r\t]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[ .-]+|[ .-]+$/g, "")
    .slice(0, 120);
  if (!name) throw new Error("Invalid secret name");
  const normalizedFolder = normalizeSecretFolder(folder);
  const normalizedDirectory = normalizeSecretFolder(directory);
  const parent = [normalizedFolder, normalizedDirectory].filter(Boolean).join("/");
  return `${parent ? `${parent}/` : ""}${name}.encrypted`;
}

export function matchesSecretSearch(
  name: string,
  description: string,
  query: string,
  publicMetadata: Record<string, string> = {},
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const metadataText = Object.entries(publicMetadata).flat().join("\n");
  return `${name}\n${description}\n${metadataText}`.toLocaleLowerCase().includes(normalized);
}

/** Directory nesting supported by the browsing tree and drag-and-drop moves. */
export const MAX_SECRET_DIRECTORY_DEPTH = 2;

export interface SecretTreeFile<T> {
  kind: "file";
  entry: T;
}

export interface SecretTreeDir<T> {
  kind: "dir";
  /** Directory path relative to the secrets folder, e.g. "Production/API". */
  path: string;
  name: string;
  children: SecretTreeNode<T>[];
}

export type SecretTreeNode<T> = SecretTreeFile<T> | SecretTreeDir<T>;

/**
 * Builds a browsing tree from entries' paths (relative to the secrets
 * folder), sorting directories before files at every level (both
 * alphabetically). Nesting is clipped to `maxDepth` directory levels — path
 * segments beyond that collapse into the deepest allowed directory instead
 * of creating more levels, so pre-existing deeper paths still display.
 */
export function buildSecretTree<T>(
  entries: T[],
  relativePath: (entry: T) => string,
  maxDepth: number = MAX_SECRET_DIRECTORY_DEPTH,
): SecretTreeNode<T>[] {
  interface Building {
    path: string;
    name: string;
    children: Map<string, Building>;
    files: T[];
  }
  const root: Building = { path: "", name: "", children: new Map(), files: [] };

  for (const entry of entries) {
    const parts = relativePath(entry).split("/").filter(Boolean);
    const dirParts = parts.slice(0, -1).slice(0, maxDepth);
    let node = root;
    let path = "";
    for (const part of dirParts) {
      path = path ? `${path}/${part}` : part;
      let child = node.children.get(part);
      if (!child) {
        child = { path, name: part, children: new Map(), files: [] };
        node.children.set(part, child);
      }
      node = child;
    }
    node.files.push(entry);
  }

  const toNodes = (building: Building): SecretTreeNode<T>[] => {
    const dirs = [...building.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child): SecretTreeDir<T> => ({
        kind: "dir",
        path: child.path,
        name: child.name,
        children: toNodes(child),
      }));
    const files = [...building.files]
      .sort((a, b) => relativePath(a).localeCompare(relativePath(b)))
      .map((entry): SecretTreeFile<T> => ({ kind: "file", entry }));
    return [...dirs, ...files];
  };

  return toNodes(root);
}
