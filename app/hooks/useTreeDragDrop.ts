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
        const files = collectFilesWithPaths(folderNode, "");

        if (files.length === 0) return;

        const fileIds = files.map((f) => f.id);
        setBusy(fileIds);
        try {
          let lastMeta: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] } | null = null;
          let failCount = 0;
          for (const file of files) {
            // Replace the old folder prefix with new folder path
            const relativePath = file.fullPath; // relative to folderNode
            const newFullName = newFolderPath ? `${newFolderPath}/${relativePath}` : relativePath;
            if (file.id.startsWith("new:")) {
              // Local-only file: migrate to new ID reflecting the new path
              const newTempId = `new:${newFullName}`;
              await migrateNewFileId(file.id, newTempId, newFullName);
              if (activeFileId === file.id) {
                const node = findNodeById(file.id, treeItems);
                onSelectFile(newTempId, relativePath.split("/").pop() || relativePath, node?.mimeType || "text/plain");
              }
              continue;
            }
            const res = await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "rename", fileId: file.id, name: newFullName }),
            });
            if (res.ok) {
              const data = await res.json();
              await renameCachedFile(file.id, newFullName);
              if (data.meta) lastMeta = data.meta;
            } else {
              failCount++;
            }
          }
          if (failCount > 0) alert(t("contextMenu.moveFailed"));
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
              action: "rename",
              fileId: itemId,
              name: newFullName,
            }),
          });
          if (res.ok) {
            if (newParentId !== rootFolderId) {
              setExpandedFolders((prev) => new Set(prev).add(newParentId));
            }
            const data = await res.json();
            await renameCachedFile(itemId, newFullName);
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

      // Internal tree node move
      const nodeId = e.dataTransfer.getData("application/x-tree-node-id");
      if (nodeId) {
        const nodeParent = e.dataTransfer.getData("application/x-tree-node-parent");
        await handleMoveItem(nodeId, nodeParent, folderId);
        return;
      }

      // External file upload
      const files = Array.from(e.dataTransfer.files);
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
    [upload, rootFolderId, fetchAndCacheTree, handleMoveItem, treeItems, t, activeFileId, setExpandedFolders]
  );

  const handleTreeDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const isInternal = e.dataTransfer.types.includes("application/x-tree-node-id");
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
