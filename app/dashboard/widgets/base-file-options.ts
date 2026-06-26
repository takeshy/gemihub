import type { CachedRemoteMeta } from "~/services/indexeddb-cache";

export interface BaseFileOption {
  id: string;
  name: string;
}

export function collectBaseFileOptions(files: CachedRemoteMeta["files"]): BaseFileOption[] {
  return Object.entries(files)
    .filter(([, file]) => file.name.toLowerCase().endsWith(".base"))
    .map(([id, file]) => ({ id, name: file.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findBaseFileOption(files: CachedRemoteMeta["files"], name: string): BaseFileOption | null {
  return collectBaseFileOptions(files).find((file) => file.name === name) ?? null;
}
