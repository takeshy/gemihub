import { useState, useCallback, useRef } from "react";
import type { Dispatch, SetStateAction, RefObject } from "react";
import {
  getCachedFile,
  setCachedFile,
  getCachedRemoteMeta,
  renameCachedFile,
  getLocalSyncMeta,
  setLocalSyncMeta,
  type CachedTreeNode,
  type CachedRemoteMeta,
} from "~/services/indexeddb-cache";
import { saveLocalEdit } from "~/services/edit-history-local";
import { isBinaryMimeType } from "~/services/sync-client-utils";
import { migrateNewFileId, findFileByPath } from "~/utils/file-tree-operations";
import {
  findFullFileName,
  findNodeById,
  collectFilesWithPaths,
  getFolderPath,
} from "~/utils/tree-helpers";
import type { TranslationStrings } from "~/i18n/translations";
import type { UploadReturn } from "~/hooks/useFileUpload";

interface UseTreeDragDropParams {
  treeItems: CachedTreeNode[];
  setTreeItems: Dispatch<SetStateAction<CachedTreeNode[]>>;
  rootFolderId: string;
  activeFileId: string | null;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  setBusy: (ids: string[]) => void;
  clearBusy: (ids: string[]) => void;
  fetchAndCacheTree: (refresh?: boolean) => Promise<void>;
  updateTreeFromMeta: (metaData: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] }) => Promise<void>;
  upload: (files: File[], folderId: string, namePrefix?: string, replaceMap?: Record<string, string>) => Promise<UploadReturn>;
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
  t: (key: keyof TranslationStrings) => string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Recursively read all files from a FileSystemDirectoryEntry.
 * Each returned File has its name set to the relative path (e.g. "folder/sub/file.txt").
 */
async function readDirectoryEntries(
  entry: FileSystemDirectoryEntry,
  basePath: string
): Promise<File[]> {
  const reader = entry.createReader();
  const files: File[] = [];

  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  let batch: FileSystemEntry[];
  do {
    batch = await readBatch();
    for (const item of batch) {
      const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
      if (item.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (item as FileSystemFileEntry).file(resolve, reject)
        );
        files.push(new File([file], itemPath, { type: file.type, lastModified: file.lastModified }));
      } else if (item.isDirectory) {
        const subFiles = await readDirectoryEntries(item as FileSystemDirectoryEntry, itemPath);
        for (const f of subFiles) files.push(f);
      }
    }
  } while (batch.length > 0);

  return files;
}

export function useTreeDragDrop({
  treeItems,
  setTreeItems,
  rootFolderId,
  activeFileId,
  onSelectFile,
  setBusy,
  clearBusy,
  fetchAndCacheTree,
  updateTreeFromMeta,
  upload,
  setExpandedFolders,
  t,
  scrollContainerRef,
}: UseTreeDragDropParams) {
  const [dragOverTree, setDragOverTree] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [draggingItem, setDraggingItem] = useState<{ id: string; parentId: string } | null>(null);
  const dragCounterRef = useRef(0);
  const folderDragCounterRef = useRef<Map<string, number>>(new Map());

  const handleMoveItem = useCallback(
    async (itemId: string, _oldParentId: string, newParentId: string) => {
      // Don't drop on self
      if (itemId === newParentId) return;

      // Folder move: rename all files under the folder
      if (itemId.startsWith("vfolder:")) {
        const oldFolderPath = getFolderPath(itemId);
        const folderBaseName = oldFolderPath.split("/").pop()!;
        const newParentPath = newParentId === rootFolderId ? "" : getFolderPath(newParentId);
        const newFolderPath = newParentPath ? `${newParentPath}/${folderBaseName}` : folderBaseName;

        // Don't move to same location
        if (newFolderPath === oldFolderPath) return;
        // Prevent dropping into own subtree
        if (newParentId.startsWith("vfolder:") && (getFolderPath(newParentId) + "/").startsWith(oldFolderPath + "/")) return;

        const folderNode = findNodeById(itemId, treeItems);
        if (!folderNode) return;
        // Collect from children so fullPath is relative to (not including) the folder itself
        const files = (folderNode.children ?? []).flatMap((child) => collectFilesWithPaths(child, ""));

        if (files.length === 0) return;

        // Classify files before confirm so we know the count
        const remoteFiles: Array<{ fileId: string; name: string; relativePath: string }> = [];
        const localFiles: Array<typeof files[number]> = [];
        for (const file of files) {
          const relativePath = file.fullPath;
          const newFullName = newFolderPath ? `${newFolderPath}/${relativePath}` : relativePath;
          if (file.id.startsWith("new:")) {
            localFiles.push(file);
          } else {
            remoteFiles.push({ fileId: file.id, name: newFullName, relativePath });
          }
        }

        if (remoteFiles.length >= 2 && !confirm(t("contextMenu.bulkMoveConfirm").replace("{count}", String(remoteFiles.length)))) {
          return;
        }

        const fileIds = files.map((f) => f.id);
        setBusy(fileIds);
        try {
          // Handle local-only files
          for (const file of localFiles) {
            const relativePath = file.fullPath;
            const newFullName = newFolderPath ? `${newFolderPath}/${relativePath}` : relativePath;
            const newTempId = `new:${newFullName}`;
            await migrateNewFileId(file.id, newTempId, newFullName);
            if (activeFileId === file.id) {
              const node = findNodeById(file.id, treeItems);
              onSelectFile(newTempId, relativePath.split("/").pop() || relativePath, node?.mimeType || "text/plain");
            }
          }

          let lastMeta: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] } | null = null;
          if (remoteFiles.length > 0) {
            const res = await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "bulkRename",
                files: remoteFiles.map((f) => ({ fileId: f.fileId, name: f.name })),
              }),
            });
            if (res.ok) {
              const data = await res.json();
              const failedSet = new Set(data.failedFileIds as string[]);
              if (failedSet.size > 0) alert(t("contextMenu.moveFailed"));
              await Promise.all(
                remoteFiles
                  .filter((rf) => !failedSet.has(rf.fileId))
                  .map((rf) => renameCachedFile(rf.fileId, rf.name))
              );
              if (data.meta) lastMeta = data.meta;
            } else {
              alert(t("contextMenu.moveFailed"));
            }
          }

          if (newParentId !== rootFolderId) {
            setExpandedFolders((prev) => {
              const next = new Set(prev);
              next.add(newParentId);
              next.add(`vfolder:${newFolderPath}`);
              return next;
            });
          }
          if (lastMeta) {
            await updateTreeFromMeta(lastMeta);
          } else {
            await fetchAndCacheTree();
          }
        } catch {
          alert(t("contextMenu.moveFailed"));
        } finally {
          clearBusy(fileIds);
        }
        return;
      }

      // File move
      // Find current full file name in tree
      const currentName = findFullFileName(itemId, treeItems, "");
      if (!currentName) return;

      // Get just the base file name (last segment)
      const baseName = currentName.split("/").pop()!;

      // Determine new path prefix
      const newFolderPath = newParentId === rootFolderId ? "" : getFolderPath(newParentId);
      const newFullName = newFolderPath ? `${newFolderPath}/${baseName}` : baseName;

      // Don't rename to same name
      if (newFullName === currentName) return;

      setBusy([itemId]);
      try {
        if (itemId.startsWith("new:")) {
          // Local-only file: migrate to new ID reflecting the new path
          const newTempId = `new:${newFullName}`;
          await migrateNewFileId(itemId, newTempId, newFullName);
          if (newParentId !== rootFolderId) {
            setExpandedFolders((prev) => new Set(prev).add(newParentId));
          }
          const node = findNodeById(itemId, treeItems);
          if (activeFileId === itemId) {
            onSelectFile(newTempId, baseName, node?.mimeType || "text/plain");
          }
          // Update tree in-place (no server fetch needed for local-only files)
          setTreeItems((prev) => {
            const replace = (nodes: CachedTreeNode[]): CachedTreeNode[] =>
              nodes.map((n) => {
                if (n.id === itemId) return { ...n, id: newTempId, name: baseName };
                if (n.children) return { ...n, children: replace(n.children) };
                return n;
              });
            return replace(prev);
          });
        } else {
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "bulkRename",
              files: [{ fileId: itemId, name: newFullName }],
            }),
          });
          if (res.ok) {
            if (newParentId !== rootFolderId) {
              setExpandedFolders((prev) => new Set(prev).add(newParentId));
            }
            const data = await res.json();
            const failedSet = new Set(data.failedFileIds as string[]);
            if (failedSet.has(itemId)) {
              alert(t("contextMenu.moveFailed"));
            } else {
              await renameCachedFile(itemId, newFullName);
            }
            if (data.meta) {
              await updateTreeFromMeta(data.meta);
            } else {
              await fetchAndCacheTree();
            }
          } else {
            alert(t("contextMenu.moveFailed"));
          }
        }
      } catch {
        alert(t("contextMenu.moveFailed"));
      } finally {
        clearBusy([itemId]);
      }
    },
    [treeItems, rootFolderId, fetchAndCacheTree, updateTreeFromMeta, setBusy, clearBusy, t, activeFileId, onSelectFile, setTreeItems, setExpandedFolders]
  );

  const handleMoveMultipleItems = useCallback(
    async (itemIds: string[], newParentId: string) => {
      // Filter out folders — only move files
      const fileIds = itemIds.filter((id) => !id.startsWith("vfolder:"));
      if (fileIds.length === 0) return;

      // Don't drop on self
      if (fileIds.length === 1 && fileIds[0] === newParentId) return;

      const newFolderPath = newParentId === rootFolderId ? "" : getFolderPath(newParentId);

      // Classify files into local and remote
      const localFiles: Array<{ id: string; baseName: string; currentName: string }> = [];
      const remoteFiles: Array<{ fileId: string; name: string; baseName: string }> = [];
      for (const id of fileIds) {
        const currentName = findFullFileName(id, treeItems, "");
        if (!currentName) continue;
        const baseName = currentName.split("/").pop()!;
        const newFullName = newFolderPath ? `${newFolderPath}/${baseName}` : baseName;
        if (newFullName === currentName) continue; // same location
        if (id.startsWith("new:")) {
          localFiles.push({ id, baseName, currentName });
        } else {
          remoteFiles.push({ fileId: id, name: newFullName, baseName });
        }
      }

      const totalCount = localFiles.length + remoteFiles.length;
      if (totalCount === 0) return;

      if (totalCount >= 2 && !confirm(t("contextMenu.bulkMoveConfirm").replace("{count}", String(totalCount)))) {
        return;
      }

      const allIds = [...localFiles.map((f) => f.id), ...remoteFiles.map((f) => f.fileId)];
      setBusy(allIds);
      try {
        // Handle local-only files
        for (const file of localFiles) {
          const newFullName = newFolderPath ? `${newFolderPath}/${file.baseName}` : file.baseName;
          const newTempId = `new:${newFullName}`;
          await migrateNewFileId(file.id, newTempId, newFullName);
          if (activeFileId === file.id) {
            const node = findNodeById(file.id, treeItems);
            onSelectFile(newTempId, file.baseName, node?.mimeType || "text/plain");
          }
        }

        // Handle remote files with single bulkRename call
        let lastMeta: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] } | null = null;
        if (remoteFiles.length > 0) {
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "bulkRename",
              files: remoteFiles.map((f) => ({ fileId: f.fileId, name: f.name })),
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const failedSet = new Set(data.failedFileIds as string[]);
            if (failedSet.size > 0) alert(t("contextMenu.moveFailed"));
            await Promise.all(
              remoteFiles
                .filter((rf) => !failedSet.has(rf.fileId))
                .map((rf) => renameCachedFile(rf.fileId, rf.name))
            );
            if (data.meta) lastMeta = data.meta;
          } else {
            alert(t("contextMenu.moveFailed"));
          }
        }

        if (newParentId !== rootFolderId) {
          setExpandedFolders((prev) => new Set(prev).add(newParentId));
        }
        if (lastMeta) {
          await updateTreeFromMeta(lastMeta);
        } else {
          await fetchAndCacheTree();
        }
      } catch {
        alert(t("contextMenu.moveFailed"));
      } finally {
        clearBusy(allIds);
      }
    },
    [treeItems, rootFolderId, fetchAndCacheTree, updateTreeFromMeta, setBusy, clearBusy, t, activeFileId, onSelectFile, setExpandedFolders]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverTree(false);
      setDragOverFolderId(null);
      setDraggingItem(null);
      document.body.classList.remove("tree-dragging");
      dragCounterRef.current = 0;
      folderDragCounterRef.current.clear();

      // Internal tree node move — multi-select first
      const multiNodeIds = e.dataTransfer.getData("application/x-tree-node-ids");
      if (multiNodeIds) {
        try {
          const ids = JSON.parse(multiNodeIds) as string[];
          if (ids.length > 0) {
            await handleMoveMultipleItems(ids, folderId);
            return;
          }
        } catch { /* fall through to single */ }
      }

      const nodeId = e.dataTransfer.getData("application/x-tree-node-id");
      if (nodeId) {
        const nodeParent = e.dataTransfer.getData("application/x-tree-node-parent");
        await handleMoveItem(nodeId, nodeParent, folderId);
        return;
      }

      // External file upload — detect directories via DataTransfer items API
      let files: File[];
      const items = Array.from(e.dataTransfer.items);
      const fileEntries = items.filter((item) => item.kind === "file");
      const entries = fileEntries.map((item) => item.webkitGetAsEntry?.());
      const hasDirectory = entries.some((entry) => entry?.isDirectory);

      if (hasDirectory) {
        files = [];
        for (let i = 0; i < fileEntries.length; i++) {
          const entry = entries[i];
          if (entry?.isDirectory) {
            const dirFiles = await readDirectoryEntries(
              entry as FileSystemDirectoryEntry,
              entry.name
            );
            for (const f of dirFiles) files.push(f);
          } else {
            const file = fileEntries[i].getAsFile();
            if (file) files.push(file);
          }
        }
      } else {
        files = Array.from(e.dataTransfer.files);
      }
      if (files.length === 0) return;

      // For virtual folders, add path prefix to uploaded file names
      const namePrefix = folderId.startsWith("vfolder:") ? getFolderPath(folderId) : undefined;

      // Check for duplicates
      const duplicates: { file: File; existing: CachedTreeNode }[] = [];
      for (const file of files) {
        const fullPath = namePrefix ? `${namePrefix}/${file.name}` : file.name;
        const existing = findFileByPath(treeItems, fullPath);
        if (existing) duplicates.push({ file, existing });
      }
      if (duplicates.length > 0) {
        const names = duplicates.map((d) => d.file.name).join(", ");
        const msg = t("contextMenu.fileAlreadyExists").replace("{name}", names);
        if (!confirm(msg)) return;
      }

      // Split duplicates into text and binary
      const duplicateSet = new Set(duplicates.map((d) => d.file));
      const textDuplicates = duplicates.filter((d) => !isBinaryMimeType(d.existing.mimeType));
      const binaryDuplicates = duplicates.filter((d) => isBinaryMimeType(d.existing.mimeType));
      const newFiles = files.filter((f) => !duplicateSet.has(f));

      // Handle text duplicates: local cache update only (yellow dot)
      for (const { file, existing } of textDuplicates) {
        const content = await file.text();
        const fullPath = namePrefix ? `${namePrefix}/${file.name}` : file.name;
        // saveLocalEdit must be called BEFORE setCachedFile (reads old content from cache)
        const saved = await saveLocalEdit(existing.id, fullPath, content);
        if (!saved) continue; // Content unchanged — skip
        const existingCache = await getCachedFile(existing.id);
        await setCachedFile({
          fileId: existing.id,
          content,
          md5Checksum: existingCache?.md5Checksum ?? "",
          modifiedTime: new Date().toISOString(),
          cachedAt: Date.now(),
          fileName: fullPath,
        });
        window.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId: existing.id } }));
        if (existing.id === activeFileId) {
          window.dispatchEvent(new CustomEvent("files-pulled", { detail: { fileIds: [existing.id] } }));
        }
      }

      // Handle binary duplicates: server update via replaceMap (green dot)
      if (binaryDuplicates.length > 0) {
        const replaceMap: Record<string, string> = {};
        const binaryFiles = binaryDuplicates.map((d) => {
          replaceMap[d.file.name] = d.existing.id;
          return d.file;
        });
        const result = await upload(binaryFiles, rootFolderId, namePrefix, replaceMap);
        if (result.ok) {
          await fetchAndCacheTree();
          const meta = await getCachedRemoteMeta();
          // Cache binary content as base64 and update localSyncMeta — only for files that succeeded
          const localMeta = await getLocalSyncMeta();
          for (const { file, existing } of binaryDuplicates) {
            if (result.failedNames.has(file.name)) continue;
            const base64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                resolve(dataUrl.split(",")[1]);
              };
              reader.readAsDataURL(file);
            });
            const rm = meta?.files?.[existing.id];
            await setCachedFile({
              fileId: existing.id,
              content: base64,
              md5Checksum: rm?.md5Checksum ?? "",
              modifiedTime: rm?.modifiedTime ?? "",
              cachedAt: Date.now(),
              fileName: rm?.name ?? file.name,
              encoding: "base64",
            });
            window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: existing.id } }));
            if (localMeta) {
              localMeta.files[existing.id] = {
                md5Checksum: rm?.md5Checksum ?? "",
                modifiedTime: rm?.modifiedTime ?? "",
              };
            }
          }
          if (localMeta) {
            localMeta.lastUpdatedAt = new Date().toISOString();
            await setLocalSyncMeta(localMeta);
          }
        }
      }

      // Handle new files (no duplicates): normal upload
      if (newFiles.length > 0) {
        const result = await upload(newFiles, rootFolderId, namePrefix);
        if (result.ok) {
          await fetchAndCacheTree();
          // Cache binary files as base64 so they get a green dot
          // Use uploaded.mimeType (from Drive API) instead of file.type (browser, unreliable)
          const binaryNewFiles = newFiles.filter((f) => {
            const uploaded = result.fileMap.get(f.name);
            return uploaded && isBinaryMimeType(uploaded.mimeType);
          });
          if (binaryNewFiles.length > 0) {
            const localMeta = await getLocalSyncMeta();
            for (const file of binaryNewFiles) {
              const uploaded = result.fileMap.get(file.name)!;
              const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = reader.result as string;
                  resolve(dataUrl.split(",")[1]);
                };
                reader.readAsDataURL(file);
              });
              await setCachedFile({
                fileId: uploaded.id,
                content: base64,
                md5Checksum: uploaded.md5Checksum ?? "",
                modifiedTime: uploaded.modifiedTime ?? "",
                cachedAt: Date.now(),
                fileName: uploaded.name ?? file.name,
                encoding: "base64",
              });
              window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: uploaded.id } }));
              if (localMeta) {
                localMeta.files[uploaded.id] = {
                  md5Checksum: uploaded.md5Checksum ?? "",
                  modifiedTime: uploaded.modifiedTime ?? "",
                };
              }
            }
            if (localMeta) {
              localMeta.lastUpdatedAt = new Date().toISOString();
              await setLocalSyncMeta(localMeta);
            }
          }
        }
      }

      // Expand folder if dropping into a subfolder
      if (folderId !== rootFolderId && (newFiles.length > 0 || binaryDuplicates.length > 0 || textDuplicates.length > 0)) {
        setExpandedFolders((prev) => new Set(prev).add(folderId));
      }
    },
    [upload, rootFolderId, fetchAndCacheTree, handleMoveItem, handleMoveMultipleItems, treeItems, t, activeFileId, setExpandedFolders]
  );

  const handleTreeDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const isInternal = e.dataTransfer.types.includes("application/x-tree-node-id") || e.dataTransfer.types.includes("application/x-tree-node-ids");
    e.dataTransfer.dropEffect = isInternal ? "move" : "copy";

    // Auto-scroll when dragging near edges of the scroll container
    const container = scrollContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const threshold = 40;
      const y = e.clientY;
      if (y - rect.top < threshold) {
        const proximity = Math.max(1, threshold - (y - rect.top));
        container.scrollTop -= Math.ceil(proximity / 5);
      } else if (rect.bottom - y < threshold) {
        const proximity = Math.max(1, threshold - (rect.bottom - y));
        container.scrollTop += Math.ceil(proximity / 5);
      }
    }
  }, [scrollContainerRef]);

  const handleTreeDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setDragOverTree(true);
    }
  }, []);

  const handleTreeDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragOverTree(false);
    }
  }, []);

  const handleFolderDragEnter = useCallback(
    (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const map = folderDragCounterRef.current;
      map.set(folderId, (map.get(folderId) || 0) + 1);
      if (map.get(folderId) === 1) {
        setDragOverFolderId(folderId);
      }
    },
    []
  );

  const handleFolderDragLeave = useCallback(
    (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const map = folderDragCounterRef.current;
      const count = (map.get(folderId) || 1) - 1;
      map.set(folderId, count);
      if (count === 0) {
        setDragOverFolderId((prev) => (prev === folderId ? null : prev));
      }
    },
    []
  );

  return {
    dragOverTree,
    dragOverFolderId,
    draggingItem,
    setDraggingItem,
    handleDrop,
    handleTreeDragOver,
    handleTreeDragEnter,
    handleTreeDragLeave,
    handleFolderDragEnter,
    handleFolderDragLeave,
  };
}
