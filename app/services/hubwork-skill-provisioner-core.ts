import { findFilesByExactName, createFile, updateFile, readFile, deleteFile, type DriveFile } from "~/services/google-drive.server";
import { upsertFilesInMeta, removeFileIdsFromMeta } from "~/services/sync-meta.server";

/**
 * Deterministic tie-break for singleton resources (e.g. webpage_builder
 * spreadsheet): oldest createdTime wins; ties broken by lexicographic id.
 * Both racers of a concurrent create must pick the same winner so the
 * settings update is idempotent instead of last-writer-wins.
 */
export function pickOldestSpreadsheet(matches: DriveFile[]): { keep: DriveFile; discard: DriveFile[] } {
  const sorted = [...matches].sort((a, b) => {
    const cmp = (a.createdTime ?? "").localeCompare(b.createdTime ?? "");
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });
  return { keep: sorted[0], discard: sorted.slice(1) };
}

export interface SkillFile {
  path: string;
  content: string;
  mimeType: string;
}

export interface ProvisionedFile {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  content: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

export interface ProvisionHubworkSkillFilesResult {
  files: ProvisionedFile[];
  isFirstProvision: boolean;
  /** Set only when this call created a brand-new spreadsheet. Signals to the
   *  route handler that it should write the initial hubwork settings block. */
  spreadsheetId?: string;
  /** The surviving spreadsheet ID after consolidation — set whenever the
   *  webpage_builder spreadsheet was located or created. Callers use this
   *  to rewrite stale references in user settings that might point at an
   *  ID discarded during this call. */
  spreadsheetKeptId?: string;
  /** IDs deleted during spreadsheet duplicate consolidation. */
  discardedSpreadsheetIds?: string[];
}

/**
 * Drive doesn't enforce unique filenames, so concurrent provision calls
 * (e.g. IndexedDB-bootstrap effect racing the Stripe-callback effect)
 * could have both find no existing file and then both createFile, leaving
 * the root folder with two copies of every skill file. Resolve on access:
 * keep the latest modifiedTime match and permanently delete the rest.
 */
async function findSingleSkillFile(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<{ keep: DriveFile | null; discardedIds: string[] }> {
  const matches = await findFilesByExactName(accessToken, name, parentId);
  if (matches.length === 0) return { keep: null, discardedIds: [] };
  if (matches.length === 1) return { keep: matches[0], discardedIds: [] };
  const sorted = [...matches].sort((a, b) =>
    (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "")
  );
  const [keep, ...discard] = sorted;
  await Promise.all(
    discard.map(async (f) => {
      try {
        await deleteFile(accessToken, f.id);
      } catch (err) {
        if (err instanceof Error && err.message.includes("404")) return;
        throw err;
      }
    })
  );
  return { keep, discardedIds: discard.map((f) => f.id) };
}

export async function provisionHubworkSkillFiles(
  accessToken: string,
  rootFolderId: string,
  skillFiles: SkillFile[],
  force = false,
): Promise<ProvisionHubworkSkillFilesResult> {
  const skillMdPath = skillFiles[0]?.path;
  if (!skillMdPath) return { files: [], isFirstProvision: false };

  const { keep: existing, discardedIds: skillMdDiscarded } = await findSingleSkillFile(
    accessToken,
    skillMdPath,
    rootFolderId,
  );
  if (existing && !force) {
    const { files, discardedIds } = await collectExistingFiles(accessToken, rootFolderId, skillFiles);
    const allDiscarded = [...skillMdDiscarded, ...discardedIds];
    if (allDiscarded.length > 0) {
      await removeFileIdsFromMeta(accessToken, rootFolderId, allDiscarded);
    }
    return { files, isFirstProvision: false };
  }

  const uploaded = await Promise.all(skillFiles.map(async (file) => {
    let driveFile: DriveFile;
    let discardedIds: string[] = [];
    if (file.path === skillMdPath) {
      if (existing) {
        driveFile = force
          ? await updateFile(accessToken, existing.id, file.content, file.mimeType)
          : existing;
      } else {
        driveFile = await createFile(accessToken, file.path, file.content, rootFolderId, file.mimeType);
      }
    } else {
      const { keep: existingFile, discardedIds: duplicates } = await findSingleSkillFile(
        accessToken,
        file.path,
        rootFolderId,
      );
      discardedIds = duplicates;
      if (existingFile) {
        driveFile = force
          ? await updateFile(accessToken, existingFile.id, file.content, file.mimeType)
          : existingFile;
      } else {
        driveFile = await createFile(accessToken, file.path, file.content, rootFolderId, file.mimeType);
      }
    }

    return {
      driveFile,
      discardedIds,
      provisioned: {
        id: driveFile.id,
        name: driveFile.name,
        path: file.path,
        mimeType: file.mimeType,
        content: file.content,
        md5Checksum: driveFile.md5Checksum,
        modifiedTime: driveFile.modifiedTime,
      },
    };
  }));

  await upsertFilesInMeta(accessToken, rootFolderId, uploaded.map((u) => u.driveFile));

  const allDiscarded = [...skillMdDiscarded, ...uploaded.flatMap((u) => u.discardedIds)];
  if (allDiscarded.length > 0) {
    await removeFileIdsFromMeta(accessToken, rootFolderId, allDiscarded);
  }

  return { files: uploaded.map((u) => u.provisioned), isFirstProvision: !force };
}

interface CollectedSkillFile {
  driveFile: DriveFile;
  discardedIds: string[];
  provisioned: ProvisionedFile;
}

async function collectExistingFiles(
  accessToken: string,
  rootFolderId: string,
  skillFiles: SkillFile[],
): Promise<{ files: ProvisionedFile[]; discardedIds: string[] }> {
  const allDiscardedIds: string[] = [];
  const results = await Promise.all(skillFiles.map(async (file): Promise<CollectedSkillFile | null> => {
    const { keep: driveFile, discardedIds } = await findSingleSkillFile(
      accessToken,
      file.path,
      rootFolderId,
    );
    allDiscardedIds.push(...discardedIds);
    if (!driveFile) return null;

    const content = await readFile(accessToken, driveFile.id);

    return {
      driveFile,
      discardedIds,
      provisioned: {
        id: driveFile.id,
        name: driveFile.name,
        path: file.path,
        mimeType: file.mimeType,
        content,
        md5Checksum: driveFile.md5Checksum,
        modifiedTime: driveFile.modifiedTime,
      },
    };
  }));

  const found = results.filter((r): r is CollectedSkillFile => r !== null);
  if (found.length > 0) {
    await upsertFilesInMeta(accessToken, rootFolderId, found.map((r) => r.driveFile));
  }
  return {
    files: found.map((r) => r.provisioned),
    discardedIds: allDiscardedIds,
  };
}
