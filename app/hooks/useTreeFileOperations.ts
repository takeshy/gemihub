import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DeleteConfirmRequest } from "~/components/ide/DeleteConfirmDialog";
import {
  getCachedFile,
  setCachedFile,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  deleteCachedFile,
  renameCachedFile,
  deleteEditHistoryEntry,
  getLocalSyncMeta,
  setLocalSyncMeta,
  removeLocalSyncMetaEntry,
  type CachedTreeNode,
  type CachedRemoteMeta,
} from "~/services/indexeddb-cache";
import { decryptFileContent, isEncryptedFile } from "~/services/crypto-core";
import { cryptoCache } from "~/services/crypto-cache";
import {
  migrateNewFileId,
  removeNodeFromTree,
  canConvertToHtml,
  canConvertToPdf,
  findFileByPath,
} from "~/utils/file-tree-operations";
import { findFullFileName, findNodeById, collectFileIds } from "~/utils/tree-helpers";
import type { TranslationStrings } from "~/i18n/translations";

interface UseTreeFileOperationsParams {
  treeItems: CachedTreeNode[];
  setTreeItems: Dispatch<SetStateAction<CachedTreeNode[]>>;
  activeFileId: string | null;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  encryptionEnabled: boolean;
  modifiedFiles: Set<string>;
  setModifiedFiles: Dispatch<SetStateAction<Set<string>>>;
  cachedFiles: Set<string>;
  setCachedFiles: Dispatch<SetStateAction<Set<string>>>;
  remoteMeta: CachedRemoteMeta["files"];
  setBusy: (ids: string[]) => void;
  clearBusy: (ids: string[]) => void;
  fetchAndCacheTree: (refresh?: boolean) => Promise<void>;
  updateTreeFromMeta: (metaData: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] }) => Promise<void>;
  t: (key: keyof TranslationStrings) => string;
  tempDiffData: { fileName: string; fileId: string; currentContent: string; tempContent: string; tempSavedAt: string; currentModifiedTime: string; isBinary: boolean } | null;
  setTempDiffData: Dispatch<SetStateAction<UseTreeFileOperationsParams["tempDiffData"]>>;
}

export function useTreeFileOperations({
  treeItems,
  setTreeItems,
  activeFileId,
  onSelectFile,
  encryptionEnabled,
  modifiedFiles,
  setModifiedFiles,
  cachedFiles,
  setCachedFiles,
  remoteMeta,
  setBusy,
  clearBusy,
  fetchAndCacheTree,
  updateTreeFromMeta,
  t,
  tempDiffData,
  setTempDiffData,
}: UseTreeFileOperationsParams) {
  const [deleteConfirmRequest, setDeleteConfirmRequest] = useState<DeleteConfirmRequest | null>(null);
  const pendingResolveRef = useRef<((result: { confirmed: boolean; permanent: boolean }) => void) | null>(null);

  const askDeleteConfirm = useCallback((message: string): Promise<{ confirmed: boolean; permanent: boolean }> => {
    // Cancel any existing dialog before opening a new one
    if (pendingResolveRef.current) {
      pendingResolveRef.current({ confirmed: false, permanent: false });
      pendingResolveRef.current = null;
    }
    return new Promise((resolve) => {
      pendingResolveRef.current = resolve;
      setDeleteConfirmRequest({
        message,
        resolve: (result) => {
          pendingResolveRef.current = null;
          setDeleteConfirmRequest(null);
          resolve(result);
        },
      });
    });
  }, []);

  const handleRenameSubmit = useCallback(
    async (item: CachedTreeNode, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === item.name) return;

      if (!item.isFolder && item.id.startsWith("new:")) {
        const oldFullName = item.id.slice("new:".length);
        const hasPath = oldFullName.includes("/");
        const prefix = hasPath ? oldFullName.substring(0, oldFullName.lastIndexOf("/")) : "";
        const newFullName = prefix ? `${prefix}/${trimmed}` : trimmed;
        const newTempId = `new:${newFullName}`;
        await migrateNewFileId(item.id, newTempId, newFullName);
        setTreeItems((prev) => {
          const replace = (nodes: CachedTreeNode[]): CachedTreeNode[] =>
            nodes.map((n) => {
              if (n.id === item.id) return { ...n, id: newTempId, name: trimmed };
              if (n.children) return { ...n, children: replace(n.children) };
              return n;
            });
          return replace(prev);
        });
        if (activeFileId === item.id) {
          onSelectFile(newTempId, trimmed, item.mimeType);
        }
        return;
      }

      if (item.isFolder && item.id.startsWith("vfolder:")) {
        const oldPrefix = item.id.slice("vfolder:".length);

        const parts = oldPrefix.split("/");
        parts[parts.length - 1] = trimmed;
        const newPrefix = parts.join("/");

        const fileIds = collectFileIds(item);

        // Classify files before confirm so we know the count
        const remoteFiles: Array<{ fileId: string; name: string }> = [];
        const localFileIds: string[] = [];
        for (const fid of fileIds) {
          if (fid.startsWith("new:")) {
            localFileIds.push(fid);
          } else {
            const fullName = findFullFileName(fid, treeItems, "");
            if (!fullName) continue;
            remoteFiles.push({ fileId: fid, name: newPrefix + fullName.slice(oldPrefix.length) });
          }
        }

        if (remoteFiles.length >= 2 && !confirm(t("contextMenu.bulkRenameConfirm").replace("{count}", String(remoteFiles.length)))) {
          return;
        }

        setBusy(fileIds);
        try {
          // Handle local-only files
          for (const fid of localFileIds) {
            const fullName = findFullFileName(fid, treeItems, "");
            if (!fullName) continue;
            const newFullName = newPrefix + fullName.slice(oldPrefix.length);
            const newTempId = `new:${newFullName}`;
            await migrateNewFileId(fid, newTempId, newFullName);
            if (activeFileId === fid) {
              const baseName = newFullName.split("/").pop() || newFullName;
              const node = findNodeById(fid, treeItems);
              onSelectFile(newTempId, baseName, node?.mimeType || "text/plain");
            }
          }

          let lastMeta: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] } | null = null;
          if (remoteFiles.length > 0) {
            const res = await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "bulkRename", files: remoteFiles }),
            });
            if (res.ok) {
              const data = await res.json();
              const failedSet = new Set(data.failedFileIds as string[]);
              if (failedSet.size > 0) alert(t("contextMenu.renameFailed"));
              await Promise.all(
                remoteFiles
                  .filter((rf) => !failedSet.has(rf.fileId))
                  .map((rf) => renameCachedFile(rf.fileId, rf.name))
              );
              if (data.meta) lastMeta = data.meta;
            } else {
              alert(t("contextMenu.renameFailed"));
            }
          }

          if (lastMeta) {
            await updateTreeFromMeta(lastMeta);
          } else {
            await fetchAndCacheTree();
          }
        } catch {
          alert(t("contextMenu.renameFailed"));
        } finally {
          clearBusy(fileIds);
        }
        return;
      }

      const currentFullName = findFullFileName(item.id, treeItems, "");

      let newFullName: string;
      if (currentFullName && currentFullName.includes("/")) {
        const prefix = currentFullName.substring(0, currentFullName.lastIndexOf("/"));
        newFullName = `${prefix}/${trimmed}`;
      } else {
        newFullName = trimmed;
      }

      setBusy([item.id]);
      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "bulkRename", files: [{ fileId: item.id, name: newFullName }] }),
        });
        if (res.ok) {
          const data = await res.json();
          const failedSet = new Set(data.failedFileIds as string[]);
          if (failedSet.has(item.id)) {
            alert(t("contextMenu.renameFailed"));
          } else {
            await renameCachedFile(item.id, newFullName);
            if (activeFileId === item.id) {
              onSelectFile(item.id, trimmed, item.mimeType);
            }
          }
          if (data.meta) {
            await updateTreeFromMeta(data.meta);
          } else {
            await fetchAndCacheTree();
          }
        } else {
          alert(t("contextMenu.renameFailed"));
        }
      } catch {
        alert(t("contextMenu.renameFailed"));
      } finally {
        clearBusy([item.id]);
      }
    },
    [fetchAndCacheTree, updateTreeFromMeta, t, treeItems, setBusy, clearBusy, activeFileId, onSelectFile, setTreeItems]
  );

  const handleDelete = useCallback(
    async (item: CachedTreeNode) => {
      if (!item.isFolder && item.id.startsWith("new:")) {
        const { confirmed } = await askDeleteConfirm(t("trash.softDeleteConfirm").replace("{name}", item.name));
        if (!confirmed) return;
        await deleteCachedFile(item.id);
        await deleteEditHistoryEntry(item.id);
        const meta = await getCachedRemoteMeta();
        if (meta?.files[item.id]) {
          delete meta.files[item.id];
          await setCachedRemoteMeta(meta);
        }
        setTreeItems((prev) => removeNodeFromTree(prev, item.id));
        window.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId: item.id } }));
        if (item.id === activeFileId) {
          window.history.pushState({}, "", "/");
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
        return;
      }

      if (item.isFolder && item.id.startsWith("vfolder:")) {
        const fileIds = collectFileIds(item);
        if (fileIds.length === 0) {
          // Empty virtual folder — just remove from tree
          setTreeItems((prev) => removeNodeFromTree(prev, item.id));
          return;
        }
        const { confirmed, permanent } = await askDeleteConfirm(t("trash.softDeleteFolderConfirm").replace("{count}", String(fileIds.length)).replace("{name}", item.name));
        if (!confirmed) return;

        setBusy(fileIds);
        try {
          let lastMeta: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] } | null = null;
          let failCount = 0;
          for (const fid of fileIds) {
            if (fid.startsWith("new:")) {
              await deleteCachedFile(fid);
              await deleteEditHistoryEntry(fid);
              const meta = await getCachedRemoteMeta();
              if (meta?.files[fid]) {
                delete meta.files[fid];
                await setCachedRemoteMeta(meta);
              }
              continue;
            }
            const res = await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete", fileId: fid, permanent }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.meta) lastMeta = data.meta;
              await deleteCachedFile(fid);
              await removeLocalSyncMetaEntry(fid);
              await deleteEditHistoryEntry(fid);
            } else {
              failCount++;
            }
          }
          if (failCount > 0) alert(t("trash.deleteFailed"));
          if (lastMeta) {
            await updateTreeFromMeta(lastMeta);
          } else {
            await fetchAndCacheTree();
          }
          window.dispatchEvent(new CustomEvent("file-modified", { detail: {} }));
          if (activeFileId && fileIds.includes(activeFileId)) {
            window.history.pushState({}, "", "/");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        } catch {
          alert(t("trash.deleteFailed"));
        } finally {
          clearBusy(fileIds);
        }
      } else {
        const { confirmed, permanent } = await askDeleteConfirm(t("trash.softDeleteConfirm").replace("{name}", item.name));
        if (!confirmed) return;

        setBusy([item.id]);
        try {
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", fileId: item.id, permanent }),
          });
          if (res.ok) {
            await deleteCachedFile(item.id);
            await removeLocalSyncMetaEntry(item.id);
            await deleteEditHistoryEntry(item.id);
            const data = await res.json();
            if (data.meta) {
              await updateTreeFromMeta(data.meta);
            } else {
              const updated = removeNodeFromTree(treeItems, item.id);
              setTreeItems(updated);
            }
            window.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId: item.id } }));
            if (item.id === activeFileId) {
              window.history.pushState({}, "", "/");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          } else {
            alert(t("trash.deleteFailed"));
          }
        } catch {
          alert(t("trash.deleteFailed"));
        } finally {
          clearBusy([item.id]);
        }
      }
    },
    [treeItems, fetchAndCacheTree, updateTreeFromMeta, t, setBusy, clearBusy, activeFileId, setTreeItems, askDeleteConfirm]
  );

  const handleDeleteMultiple = useCallback(
    async (fileIds: string[]): Promise<boolean> => {
      // Exclude virtual folders (they have no real entity)
      const targetIds = fileIds.filter((id) => !id.startsWith("vfolder:"));
      if (targetIds.length === 0) return false;
      const { confirmed, permanent } = await askDeleteConfirm(t("trash.bulkDeleteConfirm").replace("{count}", String(targetIds.length)));
      if (!confirmed) return false;

      setBusy(targetIds);
      try {
        let lastMeta: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] } | null = null;
        let failCount = 0;
        for (const fid of targetIds) {
          if (fid.startsWith("new:")) {
            await deleteCachedFile(fid);
            await deleteEditHistoryEntry(fid);
            const meta = await getCachedRemoteMeta();
            if (meta?.files[fid]) {
              delete meta.files[fid];
              await setCachedRemoteMeta(meta);
            }
            continue;
          }
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", fileId: fid, permanent }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.meta) lastMeta = data.meta;
            await deleteCachedFile(fid);
            await removeLocalSyncMetaEntry(fid);
            await deleteEditHistoryEntry(fid);
          } else {
            failCount++;
          }
        }
        if (failCount > 0) alert(t("trash.deleteFailed"));
        if (lastMeta) {
          await updateTreeFromMeta(lastMeta);
        } else {
          await fetchAndCacheTree();
        }
        window.dispatchEvent(new CustomEvent("file-modified", { detail: {} }));
        if (activeFileId && targetIds.includes(activeFileId)) {
          window.history.pushState({}, "", "/");
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
        return true;
      } catch {
        alert(t("trash.deleteFailed"));
        return false;
      } finally {
        clearBusy(targetIds);
      }
    },
    [fetchAndCacheTree, updateTreeFromMeta, t, setBusy, clearBusy, activeFileId, askDeleteConfirm]
  );

  const handleEncrypt = useCallback(
    async (item: CachedTreeNode) => {
      if (!encryptionEnabled) {
        alert(t("crypt.notConfigured"));
        window.location.href = "/settings";
        return;
      }

      setBusy([item.id]);
      try {
        const cached = await getCachedFile(item.id);
        if (cached && !cached.content) {
          alert(t("crypt.encryptEmptyFile"));
          return;
        }
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "encrypt",
            fileId: item.id,
            ...(cached?.content != null ? { content: cached.content } : {}),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await deleteCachedFile(item.id);
          if (data.meta) {
            await updateTreeFromMeta(data.meta);
          } else {
            await fetchAndCacheTree();
          }
        } else {
          const data = await res.json();
          alert(data.error || "Encryption failed");
        }
      } catch {
        alert("Encryption failed");
      } finally {
        clearBusy([item.id]);
      }
    },
    [fetchAndCacheTree, updateTreeFromMeta, encryptionEnabled, setBusy, clearBusy, t]
  );

  const handleDecryptWithPassword = useCallback(
    async (item: CachedTreeNode, password: string) => {
      setBusy([item.id]);
      try {
        let encContent = "";
        const cached = await getCachedFile(item.id);
        if (cached) {
          encContent = cached.content;
        } else {
          const raw = await fetch(`/api/drive/files?action=read&fileId=${item.id}`);
          if (!raw.ok) { alert(t("crypt.decryptFailed")); return; }
          const rawData = await raw.json();
          encContent = rawData.content;
        }

        let plaintext: string;
        if (isEncryptedFile(encContent)) {
          try {
            plaintext = await decryptFileContent(encContent, password);
          } catch {
            alert(t("crypt.wrongPassword"));
            return;
          }
          cryptoCache.setPassword(password);
        } else {
          plaintext = encContent;
        }

        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "decrypt", fileId: item.id, content: plaintext }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          if (res.status === 409 && errData?.error === "duplicate") {
            alert(t("crypt.decryptDuplicate").replace("{name}", errData.name));
          } else {
            alert(t("crypt.decryptFailed"));
          }
          return;
        }
        const data = await res.json();

        await deleteCachedFile(item.id);

        if (data.meta) {
          await updateTreeFromMeta(data.meta);
        } else {
          await fetchAndCacheTree();
        }

        window.dispatchEvent(
          new CustomEvent("file-decrypted", {
            detail: { fileId: item.id, newName: data.file?.name },
          })
        );
      } catch {
        alert(t("crypt.decryptFailed"));
      } finally {
        clearBusy([item.id]);
      }
    },
    [fetchAndCacheTree, updateTreeFromMeta, t, setBusy, clearBusy]
  );

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    const { fileId, tempContent, tempSavedAt, fileName } = tempDiffData;
    try {
      await setCachedFile({
        fileId,
        content: tempContent,
        md5Checksum: "",
        modifiedTime: tempSavedAt,
        cachedAt: Date.now(),
        fileName,
      });
    } catch {
      // IndexedDB write failed — ignore to avoid blocking the UI
    }
    if (fileId === activeFileId) {
      window.dispatchEvent(new CustomEvent("temp-file-downloaded", { detail: { fileId } }));
    }
    setTempDiffData(null);
  }, [tempDiffData, activeFileId, setTempDiffData]);

  const handleClearCache = useCallback(
    async (item: CachedTreeNode) => {
      try {
        if (!item.isFolder) {
          if (modifiedFiles.has(item.id)) {
            if (!confirm(t("contextMenu.clearCacheModified"))) return;
          }
          await deleteCachedFile(item.id);
          await deleteEditHistoryEntry(item.id);
          const meta = await getLocalSyncMeta();
          if (meta) {
            delete meta.files[item.id];
            meta.lastUpdatedAt = new Date().toISOString();
            await setLocalSyncMeta(meta);
          }
          setCachedFiles((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
          setModifiedFiles((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
          window.dispatchEvent(new CustomEvent("file-modified", { detail: { fileId: item.id } }));
          if (item.id === activeFileId) {
            window.history.pushState({}, "", "/");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        } else {
          const allIds = collectFileIds(item);
          const modifiedInFolder = allIds.filter((id) => modifiedFiles.has(id));
          const toDelete = allIds.filter((id) => cachedFiles.has(id));

          if (modifiedInFolder.length > 0) {
            if (!confirm(t("contextMenu.clearCacheSkipModified"))) return;
          }

          if (toDelete.length === 0) return;

          const meta = await getLocalSyncMeta();
          for (const id of toDelete) {
            await deleteCachedFile(id);
            await deleteEditHistoryEntry(id);
            if (meta) delete meta.files[id];
          }
          if (meta) {
            meta.lastUpdatedAt = new Date().toISOString();
            await setLocalSyncMeta(meta);
          }
          setCachedFiles((prev) => {
            const next = new Set(prev);
            for (const id of toDelete) next.delete(id);
            return next;
          });
          setModifiedFiles((prev) => {
            const next = new Set(prev);
            for (const id of modifiedInFolder) next.delete(id);
            return next;
          });
          window.dispatchEvent(new CustomEvent("file-modified", { detail: {} }));
          if (activeFileId && toDelete.includes(activeFileId)) {
            window.history.pushState({}, "", "/");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        }
      } catch {
        // IndexedDB error — ignore to avoid blocking the UI
      }
    },
    [modifiedFiles, cachedFiles, t, activeFileId, setCachedFiles, setModifiedFiles]
  );

  const handleDuplicate = useCallback(
    async (item: CachedTreeNode) => {
      if (item.isFolder) return;
      const currentFullName = findFullFileName(item.id, treeItems, "");
      if (!currentFullName) return;

      const lastDot = currentFullName.lastIndexOf(".");
      const base = lastDot > 0 ? currentFullName.slice(0, lastDot) : currentFullName;
      const ext = lastDot > 0 ? currentFullName.slice(lastDot) : "";
      const newName = `${base} (copy)${ext}`;

      setBusy([item.id]);
      try {
        let content = "";
        const cached = await getCachedFile(item.id);
        if (cached) {
          content = cached.content;
        } else {
          const raw = await fetch(`/api/drive/files?action=raw&fileId=${item.id}`);
          if (raw.ok) content = await raw.text();
        }

        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", name: newName, content }),
        });
        if (res.ok) {
          const data = await res.json();
          const file = data.file;
          const baseName = (file.name as string).split("/").pop()!;
          const newNode: CachedTreeNode = {
            id: file.id,
            name: baseName,
            mimeType: file.mimeType,
            isFolder: false,
            modifiedTime: file.modifiedTime ?? new Date().toISOString(),
          };
          setTreeItems((prev) => {
            const parts = (file.name as string).split("/");
            if (parts.length <= 1) {
              return [...prev, newNode].sort((a, b) => {
                if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
            }
            const parentPath = parts.slice(0, -1).join("/");
            const parentId = `vfolder:${parentPath}`;
            const insertInto = (nodes: CachedTreeNode[]): CachedTreeNode[] =>
              nodes.map((n) => {
                if (n.id === parentId && n.children) {
                  return { ...n, children: [...n.children, newNode].sort((a, b) => {
                    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
                    return a.name.localeCompare(b.name);
                  }) };
                }
                if (n.children) return { ...n, children: insertInto(n.children) };
                return n;
              });
            return insertInto(prev);
          });
          onSelectFile(file.id, baseName, file.mimeType);
        } else {
          alert(t("contextMenu.duplicateFailed"));
        }
      } catch {
        alert(t("contextMenu.duplicateFailed"));
      } finally {
        clearBusy([item.id]);
      }
    },
    [treeItems, onSelectFile, setBusy, clearBusy, t, setTreeItems]
  );

  const handlePublish = useCallback(
    async (item: CachedTreeNode) => {
      setBusy([item.id]);
      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "publish", fileId: item.id }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.meta) await updateTreeFromMeta(data.meta);
          try {
            const link = `${window.location.origin}/public/file/${item.id}/${encodeURIComponent(item.name)}`;
            await navigator.clipboard.writeText(link);
          } catch { /* clipboard may fail in insecure context */ }
          alert(t("contextMenu.published"));
        } else {
          alert(t("contextMenu.publishFailed"));
        }
      } catch {
        alert(t("contextMenu.publishFailed"));
      } finally {
        clearBusy([item.id]);
      }
    },
    [updateTreeFromMeta, t, setBusy, clearBusy]
  );

  const handleUnpublish = useCallback(
    async (item: CachedTreeNode) => {
      setBusy([item.id]);
      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unpublish", fileId: item.id }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.meta) await updateTreeFromMeta(data.meta);
          alert(t("contextMenu.unpublished"));
        } else {
          alert(t("contextMenu.unpublishFailed"));
        }
      } catch {
        alert(t("contextMenu.unpublishFailed"));
      } finally {
        clearBusy([item.id]);
      }
    },
    [updateTreeFromMeta, t, setBusy, clearBusy]
  );

  const handleCopyLink = useCallback(
    async (fileId: string) => {
      const name = remoteMeta[fileId]?.name?.split("/").pop() ?? fileId;
      const link = `${window.location.origin}/public/file/${fileId}/${encodeURIComponent(name)}`;
      try {
        await navigator.clipboard.writeText(link);
      } catch { /* clipboard may fail in insecure context */ }
      alert(link);
    },
    [remoteMeta]
  );

  const handleConvertMarkdownToPdf = useCallback(
    async (item: CachedTreeNode) => {
      if (item.isFolder) return;
      if (!canConvertToPdf(item.name, item.mimeType)) return;

      const fullName = findFullFileName(item.id, treeItems, "") ?? item.name;
      const sourceBaseName = fullName.split("/").pop() ?? fullName;
      const sourceStem = sourceBaseName.replace(/\.(md|html?)$/i, "");
      const targetBaseName = `${sourceStem}.pdf`;
      const targetFullPath = `temporaries/${targetBaseName}`;
      const existing = findFileByPath(treeItems, targetFullPath);

      if (existing) {
        const msg = t("contextMenu.fileAlreadyExists").replace("{name}", targetBaseName);
        if (!confirm(msg)) return;
      }

      let localContent: string | undefined;
      const cached = await getCachedFile(item.id);
      if (cached?.content) {
        localContent = cached.content;
      }

      const busyIds = existing ? [item.id, existing.id] : [item.id];
      setBusy(busyIds);
      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create-markdown-pdf",
            fileId: item.id,
            overwriteFileId: existing?.id,
            content: localContent,
          }),
        });

        if (!res.ok) {
          alert(t("contextMenu.convertPdfFailed"));
          return;
        }

        const data = await res.json();
        if (data.meta) {
          await updateTreeFromMeta(data.meta);
        } else {
          await fetchAndCacheTree();
        }

        const file = data.file;
        const fileBaseName = (file.name as string).split("/").pop() ?? file.name;
        onSelectFile(file.id, fileBaseName, file.mimeType);
        alert(t("contextMenu.convertedPdf"));
      } catch {
        alert(t("contextMenu.convertPdfFailed"));
      } finally {
        clearBusy(busyIds);
      }
    },
    [treeItems, t, setBusy, clearBusy, updateTreeFromMeta, fetchAndCacheTree, onSelectFile]
  );

  const handleConvertMarkdownToHtml = useCallback(
    async (item: CachedTreeNode) => {
      if (item.isFolder) return;
      if (!canConvertToHtml(item.name, item.mimeType)) return;

      const fullName = findFullFileName(item.id, treeItems, "") ?? item.name;
      const sourceBaseName = fullName.split("/").pop() ?? fullName;
      const sourceStem = sourceBaseName.replace(/\.md$/i, "");
      const targetBaseName = `${sourceStem}.html`;
      const targetFullPath = `temporaries/${targetBaseName}`;
      const existing = findFileByPath(treeItems, targetFullPath);

      if (existing) {
        const msg = t("contextMenu.fileAlreadyExists").replace("{name}", targetBaseName);
        if (!confirm(msg)) return;
      }

      let localContent: string | undefined;
      const cached = await getCachedFile(item.id);
      if (cached?.content) {
        localContent = cached.content;
      }

      const busyIds = existing ? [item.id, existing.id] : [item.id];
      setBusy(busyIds);
      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create-markdown-html",
            fileId: item.id,
            overwriteFileId: existing?.id,
            content: localContent,
          }),
        });

        if (!res.ok) {
          alert(t("contextMenu.convertHtmlFailed"));
          return;
        }

        const data = await res.json();
        if (data.meta) {
          await updateTreeFromMeta(data.meta);
        } else {
          await fetchAndCacheTree();
        }

        const file = data.file;
        const fileBaseName = (file.name as string).split("/").pop() ?? file.name;
        onSelectFile(file.id, fileBaseName, file.mimeType);
        alert(t("contextMenu.convertedHtml"));
      } catch {
        alert(t("contextMenu.convertHtmlFailed"));
      } finally {
        clearBusy(busyIds);
      }
    },
    [treeItems, t, setBusy, clearBusy, updateTreeFromMeta, fetchAndCacheTree, onSelectFile]
  );

  return {
    handleRenameSubmit,
    handleDelete,
    handleDeleteMultiple,
    handleEncrypt,
    handleDecryptWithPassword,
    handleTempDiffAccept,
    handleClearCache,
    handleDuplicate,
    handlePublish,
    handleUnpublish,
    handleCopyLink,
    handleConvertMarkdownToPdf,
    handleConvertMarkdownToHtml,
    deleteConfirmRequest,
  };
}
