import { findFileByExactName, createFile, updateFile, readFile, type DriveFile } from "~/services/google-drive.server";
import { upsertFilesInMeta } from "~/services/sync-meta.server";

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
  spreadsheetId?: string;
}

export async function provisionHubworkSkillFiles(
  accessToken: string,
  rootFolderId: string,
  skillFiles: SkillFile[],
  force = false,
): Promise<ProvisionHubworkSkillFilesResult> {
  const skillMdPath = skillFiles[0]?.path;
  if (!skillMdPath) return { files: [], isFirstProvision: false };

  const existing = await findFileByExactName(accessToken, skillMdPath, rootFolderId);
  if (existing && !force) {
    return { files: await collectExistingFiles(accessToken, rootFolderId, skillFiles), isFirstProvision: false };
  }

  const uploaded = await Promise.all(skillFiles.map(async (file) => {
    let driveFile: DriveFile;
    const existingFile = await findFileByExactName(accessToken, file.path, rootFolderId);
    if (existingFile) {
      driveFile = force
        ? await updateFile(accessToken, existingFile.id, file.content, file.mimeType)
        : existingFile;
    } else {
      driveFile = await createFile(accessToken, file.path, file.content, rootFolderId, file.mimeType);
    }

    return {
      driveFile,
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

  return { files: uploaded.map((u) => u.provisioned), isFirstProvision: !force };
}

async function collectExistingFiles(
  accessToken: string,
  rootFolderId: string,
  skillFiles: SkillFile[],
): Promise<ProvisionedFile[]> {
  const results = await Promise.all(skillFiles.map(async (file) => {
    const driveFile = await findFileByExactName(accessToken, file.path, rootFolderId);
    if (!driveFile) return null;

    const content = await readFile(accessToken, driveFile.id);

    return {
      driveFile,
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

  const found = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (found.length > 0) {
    await upsertFilesInMeta(accessToken, rootFolderId, found.map((r) => r.driveFile));
  }
  return found.map((r) => r.provisioned);
}
