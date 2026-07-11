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
