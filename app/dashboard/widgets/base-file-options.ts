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
  const options = collectBaseFileOptions(files);
  const exact = options.find((file) => file.name === name);
  if (exact) return exact;
  const lowerName = name.toLowerCase();
  const loose = options.filter((file) => file.name.toLowerCase() === lowerName);
  return loose.length === 1 ? loose[0] : null;
}
