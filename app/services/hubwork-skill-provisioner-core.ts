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
  /** Version declared by the provisioned skill manifest.json, if present. */
  skillVersion?: string;
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
 * Deterministic duplicate selection for skill files: newest modifiedTime wins,
 * ties broken by lexicographic id. Determinism matters because two concurrent
 * consolidation callers must agree on which duplicate to keep — otherwise one
 * can delete the file the other picked as winner, and subsequent provision
 * calls then find zero matches and re-create, causing duplicates to escalate
 * across successive races rather than collapse.
 */
export function pickSkillFileToKeep(matches: DriveFile[]): {
  keep: DriveFile | null;
  discard: DriveFile[];
} {
  if (matches.length === 0) return { keep: null, discard: [] };
  if (matches.length === 1) return { keep: matches[0], discard: [] };
  const sorted = [...matches].sort((a, b) => {
    const cmp = (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "");
    if (cmp !== 0) return cmp;
    return b.id.localeCompare(a.id);
  });
  return { keep: sorted[0], discard: sorted.slice(1) };
}

async function deleteDiscardedFiles(accessToken: string, discard: DriveFile[]): Promise<string[]> {
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
  return discard.map((f) => f.id);
}

/**
 * Drive doesn't enforce unique filenames, so concurrent provision calls
 * (e.g. IndexedDB-bootstrap effect racing the Stripe-callback effect)
 * could have both find no existing file and then both createFile, leaving
 * the root folder with two copies of every skill file. Resolve on access:
 * keep the deterministic winner and permanently delete the rest.
 */
async function findSingleSkillFile(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<{ keep: DriveFile | null; discardedIds: string[] }> {
  const matches = await findFilesByExactName(accessToken, name, parentId);
  const { keep, discard } = pickSkillFileToKeep(matches);
  const discardedIds = discard.length > 0 ? await deleteDiscardedFiles(accessToken, discard) : [];
  return { keep, discardedIds };
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
    let wasCreated = false;
    if (file.path === skillMdPath) {
      if (existing) {
        driveFile = force
          ? await updateFile(accessToken, existing.id, file.content, file.mimeType)
          : existing;
      } else {
        driveFile = await createFile(accessToken, file.path, file.content, rootFolderId, file.mimeType);
        wasCreated = true;
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
        wasCreated = true;
      }
    }

    return {
      driveFile,
      discardedIds,
      wasCreated,
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

  // Post-create reconciliation: Drive's list API is eventually consistent,
  // so our pre-create findFilesByExactName may have returned empty even
  // though a concurrent racer (or an earlier failed consolidation) had
  // just created a copy we couldn't see. Only run for paths we actually
  // created in this call — updateFile never produces new duplicates, so
  // skipping the force-update steady state saves 6 list calls per run.
  // When we did create, re-scan and apply the deterministic winner;
  // rewrite our returned provisioned entries if the winner isn't the
  // file we just wrote so callers see IDs that still exist on Drive.
  const createdPaths = uploaded.filter((u) => u.wasCreated).map((u) => u.driveFile.name);
  const postScanDiscarded: string[] = [];
  if (createdPaths.length > 0) {
    const reconciled = await reconcileFinal(accessToken, rootFolderId, createdPaths);
    for (const entry of uploaded) {
      if (!entry.wasCreated) continue;
      const final = reconciled.get(entry.driveFile.name);
      if (!final) continue;
      postScanDiscarded.push(...final.discardedIds);
      if (final.keptFile.id !== entry.driveFile.id) {
        entry.driveFile = final.keptFile;
        entry.provisioned.id = final.keptFile.id;
        entry.provisioned.md5Checksum = final.keptFile.md5Checksum;
        entry.provisioned.modifiedTime = final.keptFile.modifiedTime;
      }
    }
  }

  await upsertFilesInMeta(accessToken, rootFolderId, uploaded.map((u) => u.driveFile));

  const allDiscarded = [
    ...skillMdDiscarded,
    ...uploaded.flatMap((u) => u.discardedIds),
    ...postScanDiscarded,
  ];
  if (allDiscarded.length > 0) {
    await removeFileIdsFromMeta(accessToken, rootFolderId, allDiscarded);
  }

  return { files: uploaded.map((u) => u.provisioned), isFirstProvision: !force };
}

async function reconcileFinal(
  accessToken: string,
  rootFolderId: string,
  paths: string[],
): Promise<Map<string, { keptFile: DriveFile; discardedIds: string[] }>> {
  const entries = await Promise.all(
    paths.map(async (path) => {
      const matches = await findFilesByExactName(accessToken, path, rootFolderId);
      const { keep, discard } = pickSkillFileToKeep(matches);
      if (!keep) return null;
      const discardedIds = discard.length > 0 ? await deleteDiscardedFiles(accessToken, discard) : [];
      return [path, { keptFile: keep, discardedIds }] as const;
    })
  );
  return new Map(entries.filter((e): e is [string, { keptFile: DriveFile; discardedIds: string[] }] => e !== null));
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
