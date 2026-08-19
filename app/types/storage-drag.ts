export const STORAGE_DRAG_MIME = "application/x-gemihub-storage-move";

/**
 * Cross-mount drag payload. `sourceMount` is a server mount parameter
 * ("drive" | "project:{id}"); the drop target supplies its own mount and
 * posts /api/storage/move-between-mounts.
 */
export interface StorageDragPayload {
  sourceMount: string;
  moves: Array<{ from: string; to: string }>;
}

export function parseStorageDragPayload(value: string): StorageDragPayload | null {
  try {
    const parsed = JSON.parse(value) as StorageDragPayload;
    if (!parsed.sourceMount || !Array.isArray(parsed.moves) || parsed.moves.length === 0) return null;
    if (!parsed.moves.every((move) => move && typeof move.from === "string" && typeof move.to === "string")) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
