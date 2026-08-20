import type { UserSettings } from "~/types/settings";

export interface InMemoryLoaderData {
  settings?: UserSettings;
  [key: string]: unknown;
}

let readLoaderData: () => InMemoryLoaderData | null = () => null;

export function registerLoaderDataReader(
  reader: () => InMemoryLoaderData | null,
): void {
  readLoaderData = reader;
}

/** Client-only access to the latest route loader data. */
export function getCachedLoaderDataInMemory(): InMemoryLoaderData | null {
  return readLoaderData();
}
