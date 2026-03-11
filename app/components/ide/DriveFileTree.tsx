import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  File,
  ChevronRight,
  ChevronDown,
  Loader2,
  Trash2,
  Lock,
  Unlock,
  Upload,
  Pencil,
  CheckCircle2,
  XCircle,
  FolderPlus,
  FilePlus,
  History,
  Eraser,
  Download,
  FileOutput,
  Globe,
  GlobeLock,
  Copy,
  Link2,
  Search,
  MoreHorizontal,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useIsMobile } from "~/hooks/useIsMobile";
import {
  getCachedFileTree,
  setCachedFileTree,
  getCachedRemoteMeta,
  setCachedRemoteMeta,
  getCachedFile,
  getAllCachedFileIds,
  getEncryptedCachedFileIds,
  getLocallyModifiedFileIds,
  getLocalSyncMeta,
  setLocalSyncMeta,
  type CachedTreeNode,
  type CachedRemoteMeta,
} from "~/services/indexeddb-cache";
import { isEncryptedFile } from "~/services/crypto-core";
import { cryptoCache } from "~/services/crypto-cache";
import { hasNetContentChange } from "~/services/edit-history-local";
import { isBinaryMimeType } from "~/services/sync-client-utils";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useFileUpload } from "~/hooks/useFileUpload";
import { EditHistoryModal } from "./EditHistoryModal";
import { TempDiffModal } from "./TempDiffModal";
import { useI18n } from "~/i18n/context";
import type { FileListItem } from "~/contexts/EditorContext";
import {
  buildTreeFromMeta,
  flattenTree,
  canConvertToHtml,
  canConvertToPdf,
  collectModifiedFolderIds,
  findAncestorFolderIds,
} from "~/utils/file-tree-operations";
import { findFullFileName, collectFileIds } from "~/utils/tree-helpers";
import { useTreeFileOperations } from "~/hooks/useTreeFileOperations";
import { useTreeDragDrop } from "~/hooks/useTreeDragDrop";
import { useTreeFileCreate } from "~/hooks/useTreeFileCreate";

import { SKILLS_FOLDER_NAME } from "~/types/settings";

/** Top-level folder names managed by external tools, hidden by default. */
const MANAGEMENT_FOLDER_NAMES = new Set(["LocalLlmHub"]);

interface DriveFileTreeProps {
  rootFolderId: string;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  activeFileId: string | null;
  encryptionEnabled: boolean;
  onFileListChange?: (items: FileListItem[]) => void;
  onSearchOpen?: () => void;
  showManagementFolders?: boolean;
}

function getFileIcon(name: string, _mimeType: string) {
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    return <FileCode size={ICON.MD} className="text-orange-500 flex-shrink-0" />;
  }
  if (name.endsWith(".md")) {
    return <FileText size={ICON.MD} className="text-blue-500 flex-shrink-0" />;
  }
  if (name.endsWith(".json")) {
    return <FileJson size={ICON.MD} className="text-yellow-500 flex-shrink-0" />;
  }
  return <File size={ICON.MD} className="text-gray-400 flex-shrink-0" />;
}

export function DriveFileTree({
  rootFolderId,
  onSelectFile,
  activeFileId,
  encryptionEnabled,
  onFileListChange,
  onSearchOpen,
  showManagementFolders,
}: DriveFileTreeProps) {
  const [treeItems, setTreeItems] = useState<CachedTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: CachedTreeNode;
  } | null>(null);
  const [editHistoryFile, setEditHistoryFile] = useState<{ fileId: string; filePath: string; fullPath: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ item: CachedTreeNode; name: string } | null>(null);
  const [decryptDialog, setDecryptDialog] = useState<{ step: "confirm" | "password"; item: CachedTreeNode; password: string } | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedFileId, setLastClickedFileId] = useState<string | null>(null);
  const [cachedFiles, setCachedFiles] = useState<Set<string>>(new Set());
  const [encryptedFiles, setEncryptedFiles] = useState<Set<string>>(new Set());
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [tempDiffData, setTempDiffData] = useState<{
    fileName: string;
    fileId: string;
    currentContent: string;
    tempContent: string;
    tempSavedAt: string;
    currentModifiedTime: string;
    isBinary: boolean;
  } | null>(null);
  const [remoteMeta, setRemoteMeta] = useState<CachedRemoteMeta["files"]>({});
  const [busyFileIds, setBusyFileIds] = useState<Set<string>>(new Set());
  const setBusy = useCallback((ids: string[]) => {
    setBusyFileIds((prev) => { const next = new Set(prev); for (const id of ids) next.add(id); return next; });
  }, []);
  const clearBusy = useCallback((ids: string[]) => {
    setBusyFileIds((prev) => { const next = new Set(prev); for (const id of ids) next.delete(id); return next; });
  }, []);
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { progress, upload, clearProgress } = useFileUpload();

  const filteredTreeItems = useMemo(
    () =>
      showManagementFolders
        ? treeItems
        : treeItems.filter(
            (n) => !(n.isFolder && MANAGEMENT_FOLDER_NAMES.has(n.name))
          ),
    [treeItems, showManagementFolders]
  );

  const visibleFileIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (nodes: CachedTreeNode[]) => {
      for (const node of nodes) {
        if (node.isFolder) {
          if (expandedFolders.has(node.id) && node.children) {
            walk(node.children);
          }
        } else {
          ids.push(node.id);
        }
      }
    };
    walk(filteredTreeItems);
    return ids;
  }, [filteredTreeItems, expandedFolders]);

  const modifiedFolderIds = useMemo(
    () => collectModifiedFolderIds(filteredTreeItems, modifiedFiles),
    [filteredTreeItems, modifiedFiles]
  );

  const updateTreeFromMeta = useCallback(async (metaData: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] }) => {
    // Merge local-only "new:" entries from existing CachedRemoteMeta
    const [existingMeta, localMeta] = await Promise.all([getCachedRemoteMeta(), getLocalSyncMeta()]);
    const mergedFiles = { ...metaData.files };
    if (existingMeta) {
      for (const [id, entry] of Object.entries(existingMeta.files)) {
        if (id.startsWith("new:") && !(id in mergedFiles)) {
          mergedFiles[id] = entry;
        }
      }
    }
    const cachedMeta: CachedRemoteMeta = {
      id: "current",
      rootFolderId,
      lastUpdatedAt: metaData.lastUpdatedAt,
      files: mergedFiles,
      cachedAt: Date.now(),
    };
    const items = buildTreeFromMeta(cachedMeta);
    setTreeItems(items);
    setRemoteMeta(mergedFiles);
    // Update localSyncMeta names so that rename/move operations are reflected
    // — otherwise the stale local name causes computeSyncDiff to classify
    // the file as "toPull".  Only update the name field; md5 and modifiedTime
    // must stay untouched so that real content changes pushed by other devices
    // are still correctly detected as toPull.
    const syncMetaPromise = localMeta
      ? (async () => {
          let changed = false;
          for (const [id, remote] of Object.entries(metaData.files)) {
            const local = localMeta.files[id];
            if (local && local.name !== remote.name) {
              local.name = remote.name;
              changed = true;
            }
          }
          if (changed) await setLocalSyncMeta(localMeta);
        })()
      : Promise.resolve();
    await Promise.all([
      setCachedRemoteMeta(cachedMeta),
      setCachedFileTree({ id: "current", rootFolderId, items, cachedAt: Date.now() }),
      syncMetaPromise,
    ]);
  }, [rootFolderId]);

  const fetchAndCacheTree = useCallback(async (refresh = false) => {
    try {
      const url = `/api/drive/tree?folderId=${rootFolderId}${refresh ? "&refresh=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();

      if (data.meta) {
        // Merge local-only "new:" entries from existing CachedRemoteMeta
        const existingMeta = await getCachedRemoteMeta();
        const mergedFiles = { ...data.meta.files };
        if (existingMeta) {
          for (const [id, entry] of Object.entries(existingMeta.files)) {
            if (id.startsWith("new:") && !(id in mergedFiles)) {
              mergedFiles[id] = entry;
            }
          }
        }

        const cachedMeta: CachedRemoteMeta = {
          id: "current",
          rootFolderId,
          lastUpdatedAt: data.meta.lastUpdatedAt,
          files: mergedFiles,
          cachedAt: Date.now(),
        };

        // Use buildTreeFromMeta which filters system files (isSyncExcludedPath)
        const items = buildTreeFromMeta(cachedMeta);
        setTreeItems(items);
        setRemoteMeta(mergedFiles);
        await Promise.all([
          setCachedFileTree({ id: "current", rootFolderId, items, cachedAt: Date.now() }),
          setCachedRemoteMeta(cachedMeta),
        ]);
      } else {
        // Fallback: no meta available, use raw items from server
        const items = data.items as CachedTreeNode[];
        setTreeItems(items);
        await setCachedFileTree({ id: "current", rootFolderId, items, cachedAt: Date.now() });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      // Notify SkillContext (and other listeners) that the tree is ready
      window.dispatchEvent(new Event("tree-cached"));
    }
  }, [rootFolderId]);

  // Load cached/modified/encrypted file IDs when tree items change
  useEffect(() => {
    if (treeItems.length === 0) return;
    (async () => {
      try {
        const ids = await getAllCachedFileIds();
        setCachedFiles(ids);
      } catch { /* ignore */ }
      try {
        const ids = await getEncryptedCachedFileIds();
        setEncryptedFiles(ids);
      } catch { /* ignore */ }
      try {
        const ids = await getLocallyModifiedFileIds();
        const actuallyModified = new Set<string>();
        for (const id of ids) {
          if (await hasNetContentChange(id)) actuallyModified.add(id);
        }
        setModifiedFiles(actuallyModified);
      } catch { /* ignore */ }
    })();
  }, [treeItems]);

  // Listen for file-modified / file-cached events from useFileWithCache
  useEffect(() => {
    const handleModified = async (e: Event) => {
      const fileId = (e as CustomEvent).detail?.fileId;
      if (!fileId) return;
      if (await hasNetContentChange(fileId)) {
        setModifiedFiles((prev) => new Set(prev).add(fileId));
      } else {
        setModifiedFiles((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
      }
    };
    const handleCached = async (e: Event) => {
      const fileId = (e as CustomEvent).detail?.fileId;
      if (fileId) {
        setCachedFiles((prev) => new Set(prev).add(fileId));
        // Check if newly cached file is encrypted by content
        try {
          const cached = await getCachedFile(fileId);
          if (cached?.content && isEncryptedFile(cached.content)) {
            setEncryptedFiles((prev) => new Set(prev).add(fileId));
          } else {
            setEncryptedFiles((prev) => {
              const next = new Set(prev);
              next.delete(fileId);
              return next;
            });
          }
        } catch { /* ignore */ }
      }
    };
    // After push/pull/sync-check, re-read modified files and refresh tree
    const syncHandler = () => {
      getLocallyModifiedFileIds().then(async (ids) => {
        const actuallyModified = new Set<string>();
        for (const id of ids) {
          if (await hasNetContentChange(id)) actuallyModified.add(id);
        }
        setModifiedFiles(actuallyModified);
      }).catch(() => {});
      fetchAndCacheTree();
    };
    const workflowHandler = () => {
      fetchAndCacheTree(true);
    };
    // When a new: file is migrated to a real Drive ID, update tree node IDs
    const handleMigrated = (e: Event) => {
      const { oldId, newId, mimeType } = (e as CustomEvent).detail;
      setTreeItems((prev) => {
        const replaceId = (nodes: CachedTreeNode[]): CachedTreeNode[] =>
          nodes.map((n) => {
            if (n.id === oldId) {
              // Keep the existing node name (base name) — don't overwrite with full path
              return { ...n, id: newId, mimeType: mimeType ?? n.mimeType };
            }
            if (n.children) {
              return { ...n, children: replaceId(n.children) };
            }
            return n;
          });
        return replaceId(prev);
      });
    };
    // When a file is decrypted (from EncryptedFileViewer), refresh tree
    const handleDecrypted = (e: Event) => {
      const { meta } = (e as CustomEvent).detail;
      if (meta) {
        updateTreeFromMeta(meta);
      } else {
        fetchAndCacheTree();
      }
    };
    // When a binary file is uploaded directly to Drive (images), update tree from meta without network call
    const handleTreeMetaUpdated = (e: Event) => {
      const { meta } = (e as CustomEvent).detail;
      if (meta) {
        updateTreeFromMeta(meta);
      }
    };
    window.addEventListener("file-modified", handleModified);
    window.addEventListener("file-cached", handleCached);
    window.addEventListener("sync-complete", syncHandler);
    window.addEventListener("workflow-completed", workflowHandler);
    window.addEventListener("file-id-migrated", handleMigrated);
    window.addEventListener("file-decrypted", handleDecrypted);
    window.addEventListener("tree-meta-updated", handleTreeMetaUpdated);
    return () => {
      window.removeEventListener("file-modified", handleModified);
      window.removeEventListener("file-cached", handleCached);
      window.removeEventListener("sync-complete", syncHandler);
      window.removeEventListener("workflow-completed", workflowHandler);
      window.removeEventListener("file-id-migrated", handleMigrated);
      window.removeEventListener("file-decrypted", handleDecrypted);
      window.removeEventListener("tree-meta-updated", handleTreeMetaUpdated);
    };
  }, [fetchAndCacheTree, updateTreeFromMeta]);

  // Persist tree to IndexedDB cache when it changes
  // (covers optimistic insert, migration ID swap, rename, delete, etc.)
  useEffect(() => {
    if (treeItems.length > 0 && rootFolderId) {
      setCachedFileTree({ id: "current", rootFolderId, items: treeItems, cachedAt: Date.now() });
    }
  }, [treeItems, rootFolderId]);

  // Push flattened file list to parent when tree or modified files change
  useEffect(() => {
    if (onFileListChange && treeItems.length > 0) {
      onFileListChange(flattenTree(treeItems, "", modifiedFiles));
    }
  }, [treeItems, onFileListChange, modifiedFiles]);

  // Auto-expand folders to reveal the active file from URL
  const expandedForFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeFileId || filteredTreeItems.length === 0) return;
    if (expandedForFileRef.current === activeFileId) return;
    const ancestors = findAncestorFolderIds(filteredTreeItems, activeFileId);
    if (ancestors !== null) {
      expandedForFileRef.current = activeFileId;
      if (ancestors.length > 0) {
        setExpandedFolders((prev) => {
          if (ancestors.every((id) => prev.has(id))) return prev;
          const next = new Set(prev);
          for (const id of ancestors) next.add(id);
          return next;
        });
      }
    }
  }, [activeFileId, filteredTreeItems]);

  // Load tree from IndexedDB cache only (server fetch happens after pull/push)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await getCachedFileTree();
      if (!cancelled && cached && cached.rootFolderId === rootFolderId) {
        setTreeItems(cached.items);
      }

      // Restore remoteMeta for status icons (shared, cached/modified dots)
      const cachedMeta = await getCachedRemoteMeta();
      if (!cancelled && cachedMeta && cachedMeta.rootFolderId === rootFolderId) {
        setRemoteMeta(cachedMeta.files);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [rootFolderId]);

  const toggleFolder = useCallback((folderId: string) => {
    setSelectedFolderId((prev) => (prev === folderId ? null : folderId));
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // --- File creation hook ---
  const {
    createFileDialog,
    setCreateFileDialog,
    folderDialog,
    setFolderDialog,
    handleCreateFolder,
    handleCreateFolderSubmit,
    handleCreateFile,
    handleUploadClick,
    handleCreateFileSubmit,
    buildDefaultName,
  } = useTreeFileCreate({
    treeItems,
    setTreeItems,
    rootFolderId,
    selectedFolderId,
    activeFileId,
    onSelectFile,
    upload,
    setExpandedFolders,
    setSelectedFolderId,
    fetchAndCacheTree,
    t,
  });

  // Listen for create-file-requested event (from mobile editor FAB)
  useEffect(() => {
    const handler = () => handleCreateFile();
    window.addEventListener("create-file-requested", handler);
    return () => window.removeEventListener("create-file-requested", handler);
  }, [handleCreateFile]);

  // Auto-clear progress after 3 seconds when all done
  useEffect(() => {
    if (progress.length === 0) return;
    const allDone = progress.every((p) => p.status !== "uploading");
    if (!allDone) return;
    const timer = setTimeout(() => clearProgress(), 3000);
    return () => clearTimeout(timer);
  }, [progress, clearProgress]);

  // --- Drag & drop hook ---
  const {
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
  } = useTreeDragDrop({
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
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, item: CachedTreeNode) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, item });
    },
    []
  );

  // --- File operation handlers hook ---
  const {
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
  } = useTreeFileOperations({
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
  });

  const getContextMenuItems = useCallback(
    (item: CachedTreeNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];

      const isNewFile = !item.isFolder && item.id.startsWith("new:");

      if (!item.isFolder) {
        items.push({
          label: t("editHistory.menuLabel"),
          icon: <History size={ICON.MD} />,
          onClick: () => {
            const fullPath = findFullFileName(item.id, treeItems, "") ?? item.name;
            setEditHistoryFile({ fileId: item.id, filePath: item.name, fullPath });
          },
        });

        items.push({
          label: t("contextMenu.download"),
          icon: <Download size={ICON.MD} />,
          onClick: async () => {
            const fileName = item.name.split("/").pop() || item.name;
            const cached = await getCachedFile(item.id);
            if (cached) {
              if (cached.encoding === "base64") {
                // Decode base64 to binary blob
                const byteString = atob(cached.content);
                const bytes = new Uint8Array(byteString.length);
                for (let i = 0; i < byteString.length; i++) {
                  bytes[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: item.mimeType || "application/octet-stream" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return;
              }
              if (!isBinaryMimeType(item.mimeType)) {
                const blob = new Blob([cached.content], { type: item.mimeType || "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return;
              }
            }
            // Fallback to API download (binary without cache, or no cache at all)
            if (isNewFile) return; // new: files have no server-side data
            const a = document.createElement("a");
            a.href = `/api/drive/files?action=raw&fileId=${item.id}`;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          },
        });

        // Operations that require a real Drive file ID — hide for new: files
        if (!isNewFile) {
          if (canConvertToPdf(item.name, item.mimeType)) {
            items.push({
              label: t("contextMenu.convertToPdf"),
              icon: <FileOutput size={ICON.MD} />,
              onClick: () => handleConvertMarkdownToPdf(item),
            });
          }

          if (canConvertToHtml(item.name, item.mimeType)) {
            items.push({
              label: t("contextMenu.convertToHtml"),
              icon: <FileCode size={ICON.MD} />,
              onClick: () => handleConvertMarkdownToHtml(item),
            });
          }

          // Publish / unpublish — not for encrypted files
          if (!item.name.endsWith(".encrypted") && !encryptedFiles.has(item.id)) {
            const fileMeta = remoteMeta[item.id];
            if (fileMeta?.shared) {
              items.push({
                label: t("contextMenu.copyLink"),
                icon: <Link2 size={ICON.MD} />,
                onClick: () => handleCopyLink(item.id),
              });
              items.push({
                label: t("contextMenu.unpublish"),
                icon: <GlobeLock size={ICON.MD} />,
                onClick: () => handleUnpublish(item),
              });
            } else {
              items.push({
                label: t("contextMenu.publish"),
                icon: <Globe size={ICON.MD} />,
                onClick: () => handlePublish(item),
              });
            }
          }

          // Encrypt / Decrypt
          if (!item.name.endsWith(".encrypted") && !encryptedFiles.has(item.id)) {
            items.push({
              label: t("crypt.encrypt"),
              icon: <Lock size={ICON.MD} />,
              onClick: () => handleEncrypt(item),
            });
          } else {
            items.push({
              label: t("crypt.decrypt"),
              icon: <Unlock size={ICON.MD} />,
              onClick: () => setDecryptDialog({ step: "confirm", item, password: "" }),
            });
          }
        }
      }

      // Cache clear - available for both files and folders
      if (!item.isFolder && cachedFiles.has(item.id)) {
        items.push({
          label: t("contextMenu.clearCache"),
          icon: <Eraser size={ICON.MD} />,
          onClick: () => handleClearCache(item),
        });
      } else if (item.isFolder && collectFileIds(item).some(id => cachedFiles.has(id))) {
        items.push({
          label: t("contextMenu.clearCache"),
          icon: <Eraser size={ICON.MD} />,
          onClick: () => handleClearCache(item),
        });
      }

      if (!item.isFolder) {
        items.push({
          label: t("contextMenu.duplicate"),
          icon: <Copy size={ICON.MD} />,
          onClick: () => handleDuplicate(item),
        });
      }

      items.push({
        label: t("contextMenu.rename"),
        icon: <Pencil size={ICON.MD} />,
        onClick: () => setRenameDialog({ item, name: item.name }),
      });

      items.push({
        label: t("trash.tabTrash"),
        icon: <Trash2 size={ICON.MD} />,
        onClick: () => handleDelete(item),
        danger: true,
      });

      return items;
    },
    [handleDelete, handleDuplicate, handleEncrypt, handleClearCache, handlePublish, handleUnpublish, handleCopyLink, handleConvertMarkdownToPdf, handleConvertMarkdownToHtml, remoteMeta, cachedFiles, encryptedFiles, t, treeItems]
  );

  const renderItem = (item: CachedTreeNode, depth: number, parentId: string) => {
    const isDragging = draggingItem
      ? selectedIds.has(draggingItem.id)
        ? selectedIds.has(item.id)
        : draggingItem.id === item.id
      : false;

    if (item.isFolder) {
      const expanded = expandedFolders.has(item.id);
      const isDragOver = dragOverFolderId === item.id;
      const isSelected = selectedFolderId === item.id;
      const folderEmoji = (depth === 0 && item.name === SKILLS_FOLDER_NAME) ? "✨ "
        : item.name === "workflows" ? "⚡ "
        : "";

      return (
        <div key={item.id}>
          <button
            draggable
            onClick={() => { setSelectedIds(new Set()); toggleFolder(item.id); }}
            onContextMenu={(e) => handleContextMenu(e, item)}
            onDragStart={(e) => {
              setSelectedIds(new Set());
              e.dataTransfer.setData("application/x-tree-node-id", item.id);
              e.dataTransfer.setData("application/x-tree-node-parent", parentId);
              e.dataTransfer.effectAllowed = "move";
              setDraggingItem({ id: item.id, parentId });
              document.body.classList.add("tree-dragging");
            }}
            onDragEnd={() => { setDraggingItem(null); setSelectedIds(new Set()); document.body.classList.remove("tree-dragging"); }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDragEnter={(e) => handleFolderDragEnter(e, item.id)}
            onDragLeave={(e) => handleFolderDragLeave(e, item.id)}
            onDrop={(e) => handleDrop(e, item.id)}
            className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm ${
              isDragOver
                ? "bg-blue-100 ring-1 ring-blue-400 dark:bg-blue-900/40 dark:ring-blue-500"
                : isSelected
                  ? "bg-gray-200 dark:bg-gray-700"
                  : "hover:bg-gray-100 dark:hover:bg-gray-800"
            } ${isDragging ? "opacity-50" : ""}`}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            {expanded ? (
              <ChevronDown size={ICON.SM} className="text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronRight size={ICON.SM} className="text-gray-400 flex-shrink-0" />
            )}
            {busyFileIds.size > 0 && item.children?.some((c) => busyFileIds.has(c.id)) ? (
              <Loader2 size={ICON.MD} className="animate-spin text-blue-500 flex-shrink-0" />
            ) : expanded ? (
              <FolderOpen size={ICON.MD} className="text-yellow-500 flex-shrink-0" />
            ) : (
              <Folder size={ICON.MD} className="text-yellow-500 flex-shrink-0" />
            )}
            <span className="truncate text-gray-700 dark:text-gray-300">
              {`${folderEmoji}${item.name}`}
            </span>
            {isMobile && (
              <span
                className="ml-auto flex-shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                onClick={(e) => { e.stopPropagation(); handleContextMenu(e as unknown as React.MouseEvent, item); }}
              >
                <MoreHorizontal size={ICON.MD} />
              </span>
            )}
            {modifiedFolderIds.has(item.id) && (
              <span className={`${isMobile ? "" : "ml-auto "}w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0`} title="Contains modified files" />
            )}
          </button>
          {expanded &&
            item.children?.map((child) => renderItem(child, depth + 1, item.id))}
        </div>
      );
    }

    const isActive = item.id === activeFileId;
    const isMultiSelected = selectedIds.has(item.id);

    return (
      <button
        key={item.id}
        draggable
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) {
            // Toggle selection
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
              return next;
            });
            setLastClickedFileId(item.id);
            return;
          }
          if (e.shiftKey && lastClickedFileId) {
            // Range selection
            const startIdx = visibleFileIds.indexOf(lastClickedFileId);
            const endIdx = visibleFileIds.indexOf(item.id);
            if (startIdx !== -1 && endIdx !== -1) {
              const lo = Math.min(startIdx, endIdx);
              const hi = Math.max(startIdx, endIdx);
              setSelectedIds(new Set(visibleFileIds.slice(lo, hi + 1)));
            }
            return;
          }
          // Normal click — clear selection, open file
          setSelectedIds(new Set());
          setSelectedFolderId(null);
          setLastClickedFileId(item.id);
          onSelectFile(item.id, item.name, item.mimeType);
        }}
        onContextMenu={(e) => handleContextMenu(e, item)}
        onDragStart={(e) => {
          if (selectedIds.has(item.id) && selectedIds.size > 1) {
            // Multi-drag: set selected IDs
            e.dataTransfer.setData("application/x-tree-node-ids", JSON.stringify([...selectedIds]));
            e.dataTransfer.effectAllowed = "move";
            setDraggingItem({ id: item.id, parentId });
            // Custom drag ghost with count badge
            const ghost = document.createElement("div");
            ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;padding:4px 10px;background:#4f46e5;color:white;border-radius:8px;font-size:13px;white-space:nowrap;";
            ghost.textContent = t("fileTree.selectedCount").replace("{count}", String(selectedIds.size));
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 0, 0);
            requestAnimationFrame(() => document.body.removeChild(ghost));
          } else {
            // Single drag: clear selection
            setSelectedIds(new Set());
            e.dataTransfer.setData("application/x-tree-node-id", item.id);
            e.dataTransfer.setData("application/x-tree-node-parent", parentId);
            e.dataTransfer.effectAllowed = "move";
            setDraggingItem({ id: item.id, parentId });
          }
          document.body.classList.add("tree-dragging");
        }}
        onDragEnd={() => { setDraggingItem(null); setSelectedIds(new Set()); document.body.classList.remove("tree-dragging"); }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDragEnter={(e) => handleFolderDragEnter(e, parentId)}
        onDragLeave={(e) => handleFolderDragLeave(e, parentId)}
        onDrop={(e) => handleDrop(e, parentId)}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm ${
          isMultiSelected
            ? "bg-indigo-50 text-gray-700 dark:bg-indigo-900/30 dark:text-gray-300"
            : isActive
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        } ${isDragging ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        {busyFileIds.has(item.id)
          ? <Loader2 size={ICON.MD} className="animate-spin text-blue-500 flex-shrink-0" />
          : getFileIcon(item.name, item.mimeType)}
        <span className="truncate">{item.name}</span>
        {isMobile && (
          <span
            className="ml-auto flex-shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            onClick={(e) => { e.stopPropagation(); handleContextMenu(e as unknown as React.MouseEvent, item); }}
          >
            <MoreHorizontal size={ICON.MD} />
          </span>
        )}
        {remoteMeta[item.id]?.shared && (
          <span
            className={`${isMobile ? "" : "ml-auto "}flex-shrink-0 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer`}
            title={`${window.location.origin}/public/file/${item.id}/${encodeURIComponent(remoteMeta[item.id]?.name?.split("/").pop() ?? item.name)}`}
            onClick={(e) => { e.stopPropagation(); handleCopyLink(item.id); }}
          >
            <Globe size={ICON.SM} />
          </span>
        )}
        {modifiedFiles.has(item.id) ? (
          <span className={`${remoteMeta[item.id]?.shared || isMobile ? "" : "ml-auto "}w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0`} title="Modified" />
        ) : cachedFiles.has(item.id) ? (
          <span className={`${remoteMeta[item.id]?.shared || isMobile ? "" : "ml-auto "}w-2 h-2 rounded-full bg-green-500 flex-shrink-0`} title="Cached" />
        ) : null}
      </button>
    );
  };

  return (
    <div
      className={`flex h-full flex-col ${
        dragOverTree && !dragOverFolderId
          ? "bg-blue-50 border-2 border-dashed border-blue-300 dark:bg-blue-950/30 dark:border-blue-600"
          : ""
      }`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setSelectedIds(new Set());
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "a") {
          e.preventDefault();
          setSelectedIds(new Set(visibleFileIds));
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
          e.preventDefault();
          const ids = [...selectedIds];
          handleDeleteMultiple(ids).then((ok) => { if (ok) setSelectedIds(new Set()); });
        }
      }}
      onDragOver={handleTreeDragOver}
      onDragEnter={handleTreeDragEnter}
      onDragLeave={handleTreeDragLeave}
      onDrop={(e) => handleDrop(e, rootFolderId)}
    >
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {selectedIds.size > 0
            ? t("fileTree.selectedCount").replace("{count}", String(selectedIds.size))
            : "Files"}
        </span>
        <div className="flex items-center gap-0.5">
          {selectedIds.size > 0 && (
            <button
              onClick={async () => { if (await handleDeleteMultiple([...selectedIds])) setSelectedIds(new Set()); }}
              className="rounded p-0.5 text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              title={t("trash.tabTrash")}
            >
              <Trash2 size={ICON.MD} />
            </button>
          )}
          {onSearchOpen && (
            <button
              onClick={onSearchOpen}
              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              title="Search"
            >
              <Search size={ICON.MD} />
            </button>
          )}
          <button
            onClick={handleCreateFile}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="New File"
          >
            <FilePlus size={ICON.MD} />
          </button>
          <button
            onClick={handleCreateFolder}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="New Folder"
          >
            <FolderPlus size={ICON.MD} />
          </button>
          <button
            onClick={handleUploadClick}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Upload Files"
          >
            <Upload size={ICON.MD} />
          </button>
        </div>
      </div>
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto py-1">
        {loading && filteredTreeItems.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={ICON.LG} className="animate-spin text-gray-400" />
          </div>
        ) : filteredTreeItems.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-gray-400">
            {dragOverTree ? (
              <div className="flex flex-col items-center gap-1">
                <Upload size={ICON.XL} className="text-blue-400" />
                <span className="text-blue-500">Drop files here</span>
              </div>
            ) : (
              "No files found"
            )}
          </div>
        ) : (
          filteredTreeItems.map((item) => renderItem(item, 0, rootFolderId))
        )}
      </div>

      {progress.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-800 px-2 py-1 space-y-0.5">
          {progress.map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              className="flex items-center gap-1 text-xs"
            >
              {p.status === "uploading" && (
                <Loader2
                  size={ICON.SM}
                  className="animate-spin text-blue-500 flex-shrink-0"
                />
              )}
              {p.status === "done" && (
                <CheckCircle2 size={ICON.SM} className="text-green-500 flex-shrink-0" />
              )}
              {p.status === "error" && (
                <XCircle size={ICON.SM} className="text-red-500 flex-shrink-0" />
              )}
              <span className="truncate text-gray-600 dark:text-gray-400">
                {p.name}
              </span>
              {p.error && (
                <span className="text-red-500 truncate text-[10px]">
                  {p.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.item)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {editHistoryFile && (
        <EditHistoryModal
          fileId={editHistoryFile.fileId}
          filePath={editHistoryFile.filePath}
          fullFilePath={editHistoryFile.fullPath}
          onClose={() => setEditHistoryFile(null)}
          onFileCreated={(file) => {
            const baseName = (file.name as string).split("/").pop()!;
            const newNode: CachedTreeNode = {
              id: file.id,
              name: baseName,
              mimeType: file.mimeType,
              isFolder: false,
              modifiedTime: new Date().toISOString(),
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
          }}
        />
      )}

      {renameDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={() => setRenameDialog(null)}>
          <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {t("contextMenu.rename")}
            </h3>
            <input
              type="text"
              value={renameDialog.name}
              onChange={(e) => setRenameDialog((prev) => prev ? { ...prev, name: e.target.value } : prev)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameSubmit(renameDialog.item, renameDialog.name);
                  setRenameDialog(null);
                }
                if (e.key === "Escape") setRenameDialog(null);
              }}
              className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRenameDialog(null)}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {t("fileTree.cancel")}
              </button>
              <button
                onClick={() => { handleRenameSubmit(renameDialog.item, renameDialog.name); setRenameDialog(null); }}
                disabled={!renameDialog.name.trim() || renameDialog.name.trim() === renameDialog.item.name}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {t("common.ok")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {folderDialog.open && createPortal(
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={() => setFolderDialog({ open: false, name: "", targetFolderId: null })}>
          <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {t("fileTree.folderName")}
            </h3>
            {folderDialog.targetFolderId?.startsWith("vfolder:") && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">
                {folderDialog.targetFolderId.slice("vfolder:".length)}/
              </p>
            )}
            <input
              type="text"
              value={folderDialog.name}
              onChange={(e) => setFolderDialog((prev) => ({ ...prev, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolderSubmit();
                if (e.key === "Escape") setFolderDialog({ open: false, name: "", targetFolderId: null });
              }}
              className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setFolderDialog({ open: false, name: "", targetFolderId: null })}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {t("fileTree.cancel")}
              </button>
              <button
                onClick={handleCreateFolderSubmit}
                disabled={!folderDialog.name.trim()}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {t("common.ok")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {decryptDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={() => setDecryptDialog(null)}>
          <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            {decryptDialog.step === "confirm" ? (
              <>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                  {t("crypt.decryptConfirm")}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setDecryptDialog(null)}
                    className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t("fileTree.cancel")}
                  </button>
                  <button
                    onClick={() => {
                      const cached = cryptoCache.getPassword();
                      if (cached) {
                        const item = decryptDialog.item;
                        setDecryptDialog(null);
                        handleDecryptWithPassword(item, cached);
                      } else {
                        setDecryptDialog((prev) => prev ? { ...prev, step: "password" } : prev);
                      }
                    }}
                    className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
                  >
                    {t("common.ok")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  {t("crypt.enterPassword")}
                </h3>
                <input
                  type="password"
                  value={decryptDialog.password}
                  onChange={(e) => setDecryptDialog((prev) => prev ? { ...prev, password: e.target.value } : prev)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && decryptDialog.password) {
                      const { item, password } = decryptDialog;
                      setDecryptDialog(null);
                      handleDecryptWithPassword(item, password);
                    }
                    if (e.key === "Escape") setDecryptDialog(null);
                  }}
                  placeholder={t("crypt.passwordPlaceholder")}
                  className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setDecryptDialog(null)}
                    className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t("fileTree.cancel")}
                  </button>
                  <button
                    onClick={() => {
                      if (!decryptDialog.password) return;
                      const { item, password } = decryptDialog;
                      setDecryptDialog(null);
                      handleDecryptWithPassword(item, password);
                    }}
                    disabled={!decryptDialog.password}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {t("common.ok")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {createFileDialog.open && createPortal(
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={() => setCreateFileDialog((prev) => ({ ...prev, open: false }))}>
          <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {t("fileTree.newFile")}
            </h3>
            <div className="flex gap-2 mb-4">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("fileTree.fileName")}</label>
                <input
                  type="text"
                  value={createFileDialog.name}
                  onChange={(e) => setCreateFileDialog((prev) => ({ ...prev, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFileSubmit();
                    if (e.key === "Escape") setCreateFileDialog((prev) => ({ ...prev, open: false }));
                  }}
                  className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
                {!createFileDialog.name.trim() && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {t("fileTree.fileNameDefault").replace("{name}", buildDefaultName())}
                  </p>
                )}
              </div>
              <div className="w-24">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("fileTree.extension")}</label>
                <select
                  value={createFileDialog.ext}
                  onChange={(e) => setCreateFileDialog((prev) => ({ ...prev, ext: e.target.value }))}
                  className="w-full px-2 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value=".md">.md</option>
                  <option value=".txt">.txt</option>
                  <option value=".yaml">.yaml</option>
                  <option value=".json">.json</option>
                  <option value=".html">.html</option>
                  <option value="custom">{t("fileTree.customExt")}</option>
                </select>
              </div>
              {createFileDialog.ext === "custom" && (
                <div className="w-24">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">&nbsp;</label>
                  <input
                    type="text"
                    value={createFileDialog.customExt}
                    onChange={(e) => setCreateFileDialog((prev) => ({ ...prev, customExt: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFileSubmit();
                      if (e.key === "Escape") setCreateFileDialog((prev) => ({ ...prev, open: false }));
                    }}
                    placeholder=".csv"
                    className="w-full px-2 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 mb-4">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createFileDialog.addDateTime}
                  onChange={(e) => setCreateFileDialog((prev) => ({ ...prev, addDateTime: e.target.checked }))}
                />
                {t("fileTree.addDateTime")}
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createFileDialog.addLocation}
                  onChange={(e) => setCreateFileDialog((prev) => ({ ...prev, addLocation: e.target.checked }))}
                />
                {t("fileTree.addLocation")}
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCreateFileDialog((prev) => ({ ...prev, open: false }))}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {t("fileTree.cancel")}
              </button>
              <button
                onClick={handleCreateFileSubmit}
                disabled={createFileDialog.ext === "custom" && !createFileDialog.customExt.trim()}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {t("fileTree.create")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {tempDiffData && (
        <TempDiffModal
          fileName={tempDiffData.fileName}
          currentContent={tempDiffData.currentContent}
          tempContent={tempDiffData.tempContent}
          tempSavedAt={tempDiffData.tempSavedAt}
          currentModifiedTime={tempDiffData.currentModifiedTime}
          isBinary={tempDiffData.isBinary}
          onAccept={handleTempDiffAccept}
          onReject={() => setTempDiffData(null)}
        />
      )}
    </div>
  );
}
