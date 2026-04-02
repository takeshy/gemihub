import { findFileByExactName, createFile, updateFile, readFile } from "~/services/google-drive.server";
import { upsertFileInMeta } from "~/services/sync-meta.server";

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

  const result: ProvisionedFile[] = [];
  for (const file of skillFiles) {
    let driveFile;
    const existingFile = await findFileByExactName(accessToken, file.path, rootFolderId);
    if (existingFile) {
      driveFile = force
        ? await updateFile(accessToken, existingFile.id, file.content, file.mimeType)
        : existingFile;
    } else {
      driveFile = await createFile(accessToken, file.path, file.content, rootFolderId, file.mimeType);
    }
    await upsertFileInMeta(accessToken, rootFolderId, driveFile);

    result.push({
      id: driveFile.id,
      name: driveFile.name,
      path: file.path,
      mimeType: file.mimeType,
      content: file.content,
      md5Checksum: driveFile.md5Checksum,
      modifiedTime: driveFile.modifiedTime,
    });
  }

  return { files: result, isFirstProvision: !force };
}

async function collectExistingFiles(
  accessToken: string,
  rootFolderId: string,
  skillFiles: SkillFile[],
): Promise<ProvisionedFile[]> {
  const result: ProvisionedFile[] = [];

  for (const file of skillFiles) {
    const driveFile = await findFileByExactName(accessToken, file.path, rootFolderId);
    if (!driveFile) continue;

    await upsertFileInMeta(accessToken, rootFolderId, driveFile);

    result.push({
      id: driveFile.id,
      name: driveFile.name,
      path: file.path,
      mimeType: file.mimeType,
      content: await readFile(accessToken, driveFile.id),
      md5Checksum: driveFile.md5Checksum,
      modifiedTime: driveFile.modifiedTime,
    });
  }

  return result;
}
