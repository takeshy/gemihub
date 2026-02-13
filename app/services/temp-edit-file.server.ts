import fs from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from "node:fs";
import path from "node:path";

const TEMP_EDIT_DIR = path.join("data", "temp-edit");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TempEditEntry {
  uuid: string;
  fileId: string;
  fileName: string;
  content: string;
  createdAt: string; // ISO 8601
}

function ensureDir() {
  if (!existsSync(TEMP_EDIT_DIR)) {
    mkdirSync(TEMP_EDIT_DIR, { recursive: true });
  }
}

function safePath(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error("Invalid uuid");
  return path.join(TEMP_EDIT_DIR, `${uuid}.json`);
}

export function saveTempEditFile(
  uuid: string,
  fileId: string,
  fileName: string,
  content: string
): void {
  ensureDir();
  const entry: TempEditEntry = {
    uuid,
    fileId,
    fileName,
    content,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(safePath(uuid), JSON.stringify(entry), "utf-8");
}

export function readTempEditFile(uuid: string): TempEditEntry | null {
  try {
    const p = safePath(uuid);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export function updateTempEditContent(uuid: string, content: string): boolean {
  const entry = readTempEditFile(uuid);
  if (!entry) return false;
  entry.content = content;
  writeFileSync(safePath(uuid), JSON.stringify(entry), "utf-8");
  return true;
}

export function deleteTempEditFile(uuid: string): void {
  try {
    const p = safePath(uuid);
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // ignore
  }
}

export function listTempEditFiles(): TempEditEntry[] {
  ensureDir();
  const files = readdirSync(TEMP_EDIT_DIR).filter((f) => f.endsWith(".json"));
  const entries: TempEditEntry[] = [];
  for (const f of files) {
    try {
      const raw = readFileSync(path.join(TEMP_EDIT_DIR, f), "utf-8");
      entries.push(JSON.parse(raw));
    } catch {
      // skip malformed files
    }
  }
  return entries;
}

/** Delete entries older than 1 day (async, non-blocking) */
export async function cleanupExpired(): Promise<void> {
  ensureDir();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let files: string[];
  try {
    files = (await fs.readdir(TEMP_EDIT_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const f of files) {
    try {
      const raw = await fs.readFile(path.join(TEMP_EDIT_DIR, f), "utf-8");
      const entry: TempEditEntry = JSON.parse(raw);
      if (new Date(entry.createdAt).getTime() < cutoff) {
        await fs.unlink(path.join(TEMP_EDIT_DIR, f));
      }
    } catch {
      // skip malformed files
    }
  }
}
