export interface FileListItem {
  id: string;
  name: string;
  type: "new" | "modified" | "deleted" | "editDeleted" | "conflict";
}

export interface DialogGroupRow {
  kind: "group";
  folderPath: string;
  /** All files in this folder's subtree (including nested groups'), in input order. */
  items: FileListItem[];
  /** Rows rendered inside the group: direct file rows and nested subgroup rows. */
  children: DialogRow[];
}

export type DialogRow = { kind: "file"; item: FileListItem } | DialogGroupRow;

const MIN_GROUP_SIZE = 2;

/** Parent folder path derived from a `/`-delimited Drive path-as-name. Returns null for root-level files (no "/"). */
export function dirnameOf(path: string): string | null {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? null : path.slice(0, idx);
}

/** Ancestor folder paths of a path-as-name, shallowest first (e.g. "a/b/c.md" → ["a", "a/b"]). */
function ancestorsOf(name: string): string[] {
  const dirs: string[] = [];
  for (let dir = dirnameOf(name); dir !== null; dir = dirnameOf(dir)) dirs.unshift(dir);
  return dirs;
}

/**
 * Groups files that share an ancestor folder holding >= MIN_GROUP_SIZE changed
 * files; everything else stays an individual row. Each file is assigned to its
 * *deepest* qualifying ancestor, so group labels sit at the most specific
 * shared folder (no wrapper chains like "a" > "a/b" for files only in
 * "a/b/c"). When one group folder is an ancestor of another, the inner group
 * nests inside the outer one. Order is stable at every level: each row appears
 * at the position of its first-occurrence file in the input array.
 */
export function buildDialogRows(files: FileListItem[]): DialogRow[] {
  // Changed-file count per folder, counting the whole subtree (every ancestor).
  const countByFolder = new Map<string, number>();
  for (const f of files) {
    for (const dir of ancestorsOf(f.name)) {
      countByFolder.set(dir, (countByFolder.get(dir) ?? 0) + 1);
    }
  }

  // A folder becomes a group only if it is, for at least one file, the deepest
  // ancestor with >= MIN_GROUP_SIZE changed files in its subtree.
  const deepestGroupOf = new Map<string, string | null>();
  const groupFolders = new Set<string>();
  for (const f of files) {
    const dirs = ancestorsOf(f.name);
    let deepest: string | null = null;
    for (let i = dirs.length - 1; i >= 0; i--) {
      if ((countByFolder.get(dirs[i]) ?? 0) >= MIN_GROUP_SIZE) {
        deepest = dirs[i];
        break;
      }
    }
    deepestGroupOf.set(f.id, deepest);
    if (deepest) groupFolders.add(deepest);
  }

  const rows: DialogRow[] = [];
  const groupByPath = new Map<string, DialogGroupRow>();
  for (const f of files) {
    if (!deepestGroupOf.get(f.id)) {
      rows.push({ kind: "file", item: f });
      continue;
    }
    // Walk the group folders along this file's path, outermost first, creating
    // each group at first occurrence inside its parent's children.
    let container = rows;
    for (const dir of ancestorsOf(f.name)) {
      if (!groupFolders.has(dir)) continue;
      let group = groupByPath.get(dir);
      if (!group) {
        group = { kind: "group", folderPath: dir, items: [], children: [] };
        groupByPath.set(dir, group);
        container.push(group);
      }
      group.items.push(f);
      container = group.children;
    }
    container.push({ kind: "file", item: f });
  }
  return rows;
}
