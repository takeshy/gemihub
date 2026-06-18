/**
 * Cache server-provisioned skill files into IndexedDB and rebuild the local
 * file tree so regular skill discovery sees them immediately.
 */
export interface ProvisionedSkillFileForCache {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  content: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

export async function cacheProvisionedSkillFiles(files: ProvisionedSkillFileForCache[]): Promise<void> {
  if (files.length === 0) return;

  const {
    setCachedFile,
    deleteCachedFile,
    getCachedRemoteMeta,
    setCachedRemoteMeta,
    getLocalSyncMeta,
    setLocalSyncMeta,
    setCachedFileTree,
  } = await import("~/services/indexeddb-cache");
  const { buildTreeFromMeta } = await import("~/utils/file-tree-operations");

  const now = new Date().toISOString();
  for (const f of files) {
    await setCachedFile({
      fileId: f.id,
      content: f.content,
      md5Checksum: f.md5Checksum || "",
      modifiedTime: f.modifiedTime || now,
      cachedAt: Date.now(),
      fileName: f.path,
    });
  }

  const keepIdsByPath = new Map(files.map((f) => [f.path, f.id] as const));
  const meta = await getCachedRemoteMeta() ?? { id: "current" as const, rootFolderId: "", lastUpdatedAt: now, files: {}, cachedAt: Date.now() };
  for (const [id, entry] of Object.entries(meta.files)) {
    const keepId = entry.name ? keepIdsByPath.get(entry.name) : undefined;
    if (keepId && id !== keepId) {
      delete meta.files[id];
      await deleteCachedFile(id);
    }
  }
  for (const f of files) {
    meta.files[f.id] = {
      name: f.path,
      mimeType: f.mimeType,
      md5Checksum: f.md5Checksum || "",
      modifiedTime: f.modifiedTime || now,
    };
  }
  await setCachedRemoteMeta(meta);

  const localMeta = await getLocalSyncMeta() ?? { id: "current" as const, lastUpdatedAt: now, files: {} };
  for (const [id, entry] of Object.entries(localMeta.files)) {
    const keepId = entry.name ? keepIdsByPath.get(entry.name) : undefined;
    if (keepId && id !== keepId) {
      delete localMeta.files[id];
    }
  }
  for (const f of files) {
    localMeta.files[f.id] = {
      md5Checksum: f.md5Checksum || "",
      modifiedTime: f.modifiedTime || now,
      name: f.path,
    };
  }
  await setLocalSyncMeta(localMeta);

  const items = buildTreeFromMeta(meta, localMeta.files);
  await setCachedFileTree({
    id: "current",
    rootFolderId: meta.rootFolderId,
    items,
    cachedAt: Date.now(),
  });
  window.dispatchEvent(new Event("tree-cached"));
}
