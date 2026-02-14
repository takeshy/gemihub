import { useState, useCallback, useEffect, useRef } from "react";
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
  setCachedFile,
  getCachedFile,
  getAllCachedFileIds,
  getLocallyModifiedFileIds,
  deleteCachedFile,
  getEditHistoryForFile,
  setEditHistoryEntry,
  deleteEditHistoryEntry,
  getLocalSyncMeta,
  setLocalSyncMeta,
  removeLocalSyncMetaEntry,
  type CachedTreeNode,
  type CachedRemoteMeta,
} from "~/services/indexeddb-cache";
import { decryptFileContent, isEncryptedFile } from "~/services/crypto-core";
import { saveLocalEdit } from "~/services/edit-history-local";
import { isBinaryMimeType } from "~/services/sync-client-utils";
import { cryptoCache } from "~/services/crypto-cache";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useFileUpload } from "~/hooks/useFileUpload";
import { EditHistoryModal } from "./EditHistoryModal";
import { TempDiffModal } from "./TempDiffModal";
import { useI18n } from "~/i18n/context";
import type { FileListItem } from "~/contexts/EditorContext";

interface DriveFileTreeProps {
  rootFolderId: string;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  activeFileId: string | null;
  encryptionEnabled: boolean;
  onFileListChange?: (items: FileListItem[]) => void;
  onSearchOpen?: () => void;
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

function removeNodeFromTree(
  nodes: CachedTreeNode[],
  targetId: string
): CachedTreeNode[] {
  return nodes
    .filter((n) => n.id !== targetId)
    .map((n) =>
      n.children
        ? { ...n, children: removeNodeFromTree(n.children, targetId) }
        : n
    );
}

function buildTreeFromMeta(meta: CachedRemoteMeta): CachedTreeNode[] {
  const root: CachedTreeNode[] = [];
  const folderMap = new Map<string, CachedTreeNode>();

  function ensureFolder(pathParts: string[]): CachedTreeNode[] {
    if (pathParts.length === 0) return root;
    const fullPath = pathParts.join("/");
    const existing = folderMap.get(fullPath);
    if (existing) return existing.children!;
    const parentChildren = ensureFolder(pathParts.slice(0, -1));
    const folderName = pathParts[pathParts.length - 1];
    const folderNode: CachedTreeNode = {
      id: `vfolder:${fullPath}`,
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      isFolder: true,
      children: [],
    };
    parentChildren.push(folderNode);
    folderMap.set(fullPath, folderNode);
    return folderNode.children!;
  }

  for (const [fileId, f] of Object.entries(meta.files)) {
    const parts = f.name.split("/");
    const fileName = parts.pop()!;
    const parentChildren = ensureFolder(parts);
    parentChildren.push({
      id: fileId,
      name: fileName,
      mimeType: f.mimeType,
      isFolder: false,
      modifiedTime: f.modifiedTime,
    });
  }

  function sortChildren(nodes: CachedTreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortChildren(node.children);
    }
  }

  sortChildren(root);
  return root;
}

function flattenTree(nodes: CachedTreeNode[], parentPath: string): FileListItem[] {
  const result: FileListItem[] = [];
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.isFolder) {
      if (node.children) {
        result.push(...flattenTree(node.children, path));
      }
    } else {
      result.push({ id: node.id, name: node.name, path });
    }
  }
  return result;
}

function canConvertToHtml(name: string, mimeType: string): boolean {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith(".md") || mimeType === "text/markdown";
}

function canConvertToPdf(name: string, mimeType: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    lowerName.endsWith(".md")
    || lowerName.endsWith(".html")
    || lowerName.endsWith(".htm")
    || mimeType === "text/markdown"
    || mimeType === "text/html"
  );
}

/** Find a file node by its full path (e.g. "folder/file.txt") */
function findFileByPath(nodes: CachedTreeNode[], fullPath: string, parentPath: string = ""): CachedTreeNode | null {
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (!node.isFolder && path === fullPath) return node;
    if (node.isFolder && node.children) {
      const found = findFileByPath(node.children, fullPath, path);
      if (found) return found;
    }
  }
  return null;
}

export function DriveFileTree({
  rootFolderId,
  onSelectFile,
  activeFileId,
  encryptionEnabled,
  onFileListChange,
  onSearchOpen,
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
  const [dragOverTree, setDragOverTree] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [draggingItem, setDraggingItem] = useState<{ id: string; parentId: string } | null>(null);
  const [editHistoryFile, setEditHistoryFile] = useState<{ fileId: string; filePath: string; fullPath: string } | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [cachedFiles, setCachedFiles] = useState<Set<string>>(new Set());
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [createFileDialog, setCreateFileDialog] = useState<{
    open: boolean; name: string; ext: string; customExt: string;
  }>({ open: false, name: "", ext: ".md", customExt: "" });
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
  const dragCounterRef = useRef(0);
  const folderDragCounterRef = useRef<Map<string, number>>(new Map());
  const { progress, upload, clearProgress } = useFileUpload();

  const updateTreeFromMeta = useCallback(async (metaData: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] }) => {
    const cachedMeta: CachedRemoteMeta = {
      id: "current",
      rootFolderId,
      lastUpdatedAt: metaData.lastUpdatedAt,
      files: metaData.files,
      cachedAt: Date.now(),
    };
    const items = buildTreeFromMeta(cachedMeta);
    setTreeItems(items);
    setRemoteMeta(metaData.files);
    await Promise.all([
      setCachedRemoteMeta(cachedMeta),
      setCachedFileTree({ id: "current", rootFolderId, items, cachedAt: Date.now() }),
    ]);
  }, [rootFolderId]);

  const fetchAndCacheTree = useCallback(async (refresh = false) => {
    try {
      const url = `/api/drive/tree?folderId=${rootFolderId}${refresh ? "&refresh=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const items = data.items as CachedTreeNode[];
      setTreeItems(items);
      // Cache both tree and meta
      const promises: Promise<void>[] = [
        setCachedFileTree({ id: "current", rootFolderId, items, cachedAt: Date.now() }),
      ];
      if (data.meta) {
        setRemoteMeta(data.meta.files);
        promises.push(setCachedRemoteMeta({
          id: "current",
          rootFolderId,
          lastUpdatedAt: data.meta.lastUpdatedAt,
          files: data.meta.files,
          cachedAt: Date.now(),
        }));
      }
      await Promise.all(promises);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [rootFolderId]);

  // Load cached/modified file IDs when tree items change
  useEffect(() => {
    if (treeItems.length === 0) return;
    (async () => {
      try {
        const ids = await getAllCachedFileIds();
        setCachedFiles(ids);
      } catch { /* ignore */ }
      try {
        const ids = await getLocallyModifiedFileIds();
        setModifiedFiles(ids);
      } catch { /* ignore */ }
    })();
  }, [treeItems]);

  // Listen for file-modified / file-cached events from useFileWithCache
  useEffect(() => {
    const handleModified = (e: Event) => {
      const fileId = (e as CustomEvent).detail?.fileId;
      if (fileId) {
        setModifiedFiles((prev) => new Set(prev).add(fileId));
      }
    };
    const handleCached = (e: Event) => {
      const fileId = (e as CustomEvent).detail?.fileId;
      if (fileId) {
        setCachedFiles((prev) => new Set(prev).add(fileId));
      }
    };
    // After push/pull/sync-check, re-read modified files and refresh tree
    const syncHandler = () => {
      getLocallyModifiedFileIds().then((ids) => setModifiedFiles(ids)).catch(() => {});
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
    window.addEventListener("file-modified", handleModified);
    window.addEventListener("file-cached", handleCached);
    window.addEventListener("sync-complete", syncHandler);
    window.addEventListener("workflow-completed", workflowHandler);
    window.addEventListener("file-id-migrated", handleMigrated);
    window.addEventListener("file-decrypted", handleDecrypted);
    return () => {
      window.removeEventListener("file-modified", handleModified);
      window.removeEventListener("file-cached", handleCached);
      window.removeEventListener("sync-complete", syncHandler);
      window.removeEventListener("workflow-completed", workflowHandler);
      window.removeEventListener("file-id-migrated", handleMigrated);
      window.removeEventListener("file-decrypted", handleDecrypted);
    };
  }, [fetchAndCacheTree, updateTreeFromMeta]);

  // Persist tree to IndexedDB cache when it changes
  // (covers optimistic insert, migration ID swap, rename, delete, etc.)
  useEffect(() => {
    if (treeItems.length > 0 && rootFolderId) {
      setCachedFileTree({ id: "current", rootFolderId, items: treeItems, cachedAt: Date.now() });
    }
  }, [treeItems, rootFolderId]);

  // Push flattened file list to parent when tree changes
  useEffect(() => {
    if (onFileListChange && treeItems.length > 0) {
      onFileListChange(flattenTree(treeItems, ""));
    }
  }, [treeItems, onFileListChange]);

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

  const handleCreateFolder = useCallback(() => {
    const name = prompt("Folder name:");
    if (!name?.trim()) return;

    // Determine parent path from selected folder
    const parentPath = selectedFolderId?.startsWith("vfolder:")
      ? selectedFolderId.slice("vfolder:".length)
      : "";
    const folderPath = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
    const folderId = `vfolder:${folderPath}`;

    // Add virtual folder node to tree locally
    const newFolder: CachedTreeNode = {
      id: folderId,
      name: name.trim(),
      mimeType: "application/vnd.google-apps.folder",
      isFolder: true,
      children: [],
    };

    setTreeItems((prev) => {
      if (!parentPath) {
        // Add to root
        return [...prev, newFolder].sort((a, b) => {
          if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }
      // Add into the parent virtual folder
      const insertIntoFolder = (nodes: CachedTreeNode[]): CachedTreeNode[] =>
        nodes.map((n) => {
          if (n.id === selectedFolderId && n.children) {
            return {
              ...n,
              children: [...n.children, newFolder].sort((a, b) => {
                if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
                return a.name.localeCompare(b.name);
              }),
            };
          }
          if (n.children) {
            return { ...n, children: insertIntoFolder(n.children) };
          }
          return n;
        });
      return insertIntoFolder(prev);
    });

    // Expand parent and the new folder
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (selectedFolderId) next.add(selectedFolderId);
      next.add(folderId);
      return next;
    });
    setSelectedFolderId(folderId);
  }, [selectedFolderId]);

  const handleCreateFile = useCallback(() => {
    setCreateFileDialog({ open: true, name: "", ext: ".md", customExt: "" });
  }, []);

  const handleUploadClick = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;

      const namePrefix = selectedFolderId?.startsWith("vfolder:")
        ? selectedFolderId.slice("vfolder:".length)
        : undefined;

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

      const duplicateSet = new Set(duplicates.map((d) => d.file));
      const textDuplicates = duplicates.filter((d) => !isBinaryMimeType(d.existing.mimeType));
      const binaryDuplicates = duplicates.filter((d) => isBinaryMimeType(d.existing.mimeType));
      const newFiles = files.filter((f) => !duplicateSet.has(f));

      // Text duplicates: local cache update only
      for (const { file, existing } of textDuplicates) {
        const content = await file.text();
        const fullPath = namePrefix ? `${namePrefix}/${file.name}` : file.name;
        const saved = await saveLocalEdit(existing.id, fullPath, content);
        if (!saved) continue;
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

      // Binary duplicates: server update via replaceMap
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

      // New files: normal upload
      if (newFiles.length > 0) {
        const result = await upload(newFiles, rootFolderId, namePrefix);
        if (result.ok) {
          await fetchAndCacheTree();
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

      // Expand folder
      if (selectedFolderId && selectedFolderId !== rootFolderId) {
        setExpandedFolders((prev) => new Set(prev).add(selectedFolderId));
      }
    };
    input.click();
  }, [selectedFolderId, treeItems, t, activeFileId, upload, rootFolderId, fetchAndCacheTree]);

  const buildDefaultName = useCallback(() => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())}_${p(now.getHours())}_${p(now.getMinutes())}_${p(now.getSeconds())}`;
  }, []);

  const handleCreateFileSubmit = useCallback(async () => {
    const defaultName = buildDefaultName();
    const name = createFileDialog.name.trim() || defaultName;
    const ext = createFileDialog.ext === "custom"
      ? (createFileDialog.customExt.startsWith(".") ? createFileDialog.customExt : "." + createFileDialog.customExt)
      : createFileDialog.ext;
    const fileName = name + ext;

    setCreateFileDialog((prev) => ({ ...prev, open: false }));

    // Prepend selected folder path
    const folderPath = selectedFolderId?.startsWith("vfolder:")
      ? selectedFolderId.slice("vfolder:".length)
      : "";
    const fullName = folderPath ? `${folderPath}/${fileName}` : fileName;

    // Check for duplicate
    const existing = findFileByPath(treeItems, fullName);
    if (existing) {
      const msg = t("contextMenu.fileAlreadyExists").replace("{name}", fileName);
      if (!confirm(msg)) return;
      // Overwrite existing file
      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", fileId: existing.id, content: "" }),
        });
        if (res.ok) {
          onSelectFile(existing.id, existing.name, existing.mimeType);
        }
      } catch { /* ignore */ }
      return;
    }

    // Generate temporary ID — Drive file is created in the background below
    const tempId = `new:${fullName}`;
    const mimeType = fileName.endsWith(".yaml") || fileName.endsWith(".yml")
      ? "text/yaml"
      : "text/plain";

    // Seed IndexedDB cache with empty content
    await setCachedFile({
      fileId: tempId,
      content: "",
      md5Checksum: "",
      modifiedTime: "",
      cachedAt: Date.now(),
      fileName: fullName,
    });

    // Add the new file to the tree optimistically
    // fullName may contain "/" (e.g. "2026/02/14_15_30_45.md") — split into
    // virtual folder path + base name, creating intermediate vfolder nodes
    const fullParts = fullName.split("/");
    const baseName = fullParts.pop()!;
    // folderParts = all path segments that should be virtual folders
    const folderParts = fullParts; // e.g. ["2026", "02"]

    const newNode: CachedTreeNode = {
      id: tempId,
      name: baseName,
      mimeType,
      isFolder: false,
      modifiedTime: new Date().toISOString(),
    };

    const sortNodes = (nodes: CachedTreeNode[]) =>
      nodes.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    setTreeItems((prev) => {
      // Ensure all intermediate virtual folders exist, then insert the file
      const ensureAndInsert = (
        nodes: CachedTreeNode[],
        remainingParts: string[],
        pathSoFar: string,
      ): CachedTreeNode[] => {
        if (remainingParts.length === 0) {
          // Leaf level — insert the file here
          return sortNodes([...nodes, newNode]);
        }
        const [nextPart, ...rest] = remainingParts;
        const nextPath = pathSoFar ? `${pathSoFar}/${nextPart}` : nextPart;
        const vfolderId = `vfolder:${nextPath}`;
        const existing = nodes.find((n) => n.id === vfolderId);
        if (existing) {
          // Folder exists — recurse into it
          return nodes.map((n) =>
            n.id === vfolderId
              ? { ...n, children: ensureAndInsert(n.children ?? [], rest, nextPath) }
              : n,
          );
        }
        // Create new virtual folder node with nested children
        // Build the chain of remaining folders
        let innerChildren: CachedTreeNode[] = [newNode];
        for (let i = rest.length - 1; i >= 0; i--) {
          const partPath = nextPath + "/" + rest.slice(0, i + 1).join("/");
          const innerFolderId = `vfolder:${partPath}`;
          innerChildren = [{
            id: innerFolderId,
            name: rest[i],
            mimeType: "application/vnd.google-apps.folder",
            isFolder: true,
            children: innerChildren,
          }];
        }
        const newFolder: CachedTreeNode = {
          id: vfolderId,
          name: nextPart,
          mimeType: "application/vnd.google-apps.folder",
          isFolder: true,
          children: rest.length === 0 ? [newNode] : innerChildren,
        };
        return sortNodes([...nodes, newFolder]);
      };
      return ensureAndInsert(prev, folderParts, "");
    });

    // Expand all intermediate virtual folders + parent
    {
      const foldersToExpand: string[] = [];
      let pathAcc = "";
      for (const part of folderParts) {
        pathAcc = pathAcc ? `${pathAcc}/${part}` : part;
        foldersToExpand.push(`vfolder:${pathAcc}`);
      }
      if (foldersToExpand.length > 0) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          for (const f of foldersToExpand) next.add(f);
          return next;
        });
      }
    }

    // Open the file immediately
    onSelectFile(tempId, baseName, mimeType);

    // Create Drive file in background — migrate IDs when done
    fetch("/api/drive/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name: fullName, content: "", mimeType }),
    }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      const file = data.file;
      // Read current content from cache (user may have already typed)
      const cached = await getCachedFile(tempId);
      if (!cached) return; // temp entry was removed (e.g. file renamed/deleted before migration)
      const currentContent = cached.content;

      // Migrate editHistory entry (new: → real ID)
      const editHistory = await getEditHistoryForFile(tempId);
      if (editHistory) {
        await deleteEditHistoryEntry(tempId);
        await setEditHistoryEntry({
          ...editHistory,
          fileId: file.id,
          filePath: file.name,
        });
      }

      // If user edited before migration, push content to Drive and get final checksum
      let finalMd5 = file.md5Checksum ?? "";
      let finalModifiedTime = file.modifiedTime ?? "";
      if (currentContent) {
        try {
          const updateRes = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", fileId: file.id, content: currentContent }),
          });
          if (updateRes.ok) {
            const updateData = await updateRes.json();
            finalMd5 = updateData.md5Checksum ?? finalMd5;
            finalModifiedTime = updateData.file?.modifiedTime ?? finalModifiedTime;
          }
        } catch {
          // Content upload failed — file exists on Drive with empty content
        }
      }

      // Swap cache entries: delete temp, create real
      await deleteCachedFile(tempId);
      await setCachedFile({
        fileId: file.id,
        content: currentContent,
        md5Checksum: finalMd5,
        modifiedTime: finalModifiedTime,
        cachedAt: Date.now(),
        fileName: file.name,
      });

      // Update localSyncMeta so push/pull recognizes this file
      try {
        const localMeta = await getLocalSyncMeta();
        if (localMeta) {
          localMeta.files[file.id] = {
            md5Checksum: finalMd5,
            modifiedTime: finalModifiedTime,
          };
          localMeta.lastUpdatedAt = new Date().toISOString();
          await setLocalSyncMeta(localMeta);
        }
      } catch {
        // Non-critical — next pull will fix the inconsistency
      }

      // Notify tree, _index, and useFileWithCache to migrate
      window.dispatchEvent(
        new CustomEvent("file-id-migrated", {
          detail: { oldId: tempId, newId: file.id, fileName: file.name, mimeType: file.mimeType },
        })
      );
      // Trigger push count recalculation
      window.dispatchEvent(
        new CustomEvent("file-modified", { detail: { fileId: file.id } })
      );
    }).catch(() => {});
  }, [createFileDialog, selectedFolderId, onSelectFile, treeItems, t, buildDefaultName]);

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

  // Resolve virtual folder path from a vfolder: ID
  const getFolderPath = useCallback((folderId: string): string => {
    if (folderId.startsWith("vfolder:")) {
      return folderId.slice("vfolder:".length);
    }
    return ""; // root
  }, []);

  // Find the full Drive file name (with path prefix) for a node
  const findFullFileName = useCallback(
    (nodeId: string, nodes: CachedTreeNode[], parentPath: string): string | null => {
      for (const node of nodes) {
        const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
        if (node.id === nodeId) return fullPath;
        if (node.children) {
          const found = findFullFileName(nodeId, node.children, fullPath);
          if (found) return found;
        }
      }
      return null;
    },
    []
  );

  const handleMoveItem = useCallback(
    async (itemId: string, _oldParentId: string, newParentId: string) => {
      // Virtual folders can't be moved
      if (itemId.startsWith("vfolder:")) return;
      // Don't drop on self
      if (itemId === newParentId) return;

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
          if (data.meta) {
            await updateTreeFromMeta(data.meta);
          } else {
            await fetchAndCacheTree();
          }
        }
      } catch {
        // ignore
      } finally {
        clearBusy([itemId]);
      }
    },
    [treeItems, rootFolderId, fetchAndCacheTree, updateTreeFromMeta, findFullFileName, getFolderPath, setBusy, clearBusy]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverTree(false);
      setDragOverFolderId(null);
      setDraggingItem(null);
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
    [upload, rootFolderId, fetchAndCacheTree, handleMoveItem, getFolderPath, treeItems, t, activeFileId]
  );

  const handleTreeDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = draggingItem ? "move" : "copy";
  }, [draggingItem]);

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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, item: CachedTreeNode) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, item });
    },
    []
  );

  // Collect all real file IDs under a virtual folder node
  const collectFileIds = useCallback(
    (node: CachedTreeNode): string[] => {
      if (!node.isFolder) return [node.id];
      const ids: string[] = [];
      for (const child of node.children ?? []) {
        ids.push(...collectFileIds(child));
      }
      return ids;
    },
    []
  );

  const handleRename = useCallback(
    async (item: CachedTreeNode) => {
      // new: prefix files are not yet on Drive — rename locally only
      if (!item.isFolder && item.id.startsWith("new:")) {
        const newBaseName = prompt(t("contextMenu.rename"), item.name);
        if (!newBaseName?.trim() || newBaseName.trim() === item.name) return;
        const oldFullName = item.id.slice("new:".length);
        const hasPath = oldFullName.includes("/");
        const prefix = hasPath ? oldFullName.substring(0, oldFullName.lastIndexOf("/")) : "";
        const newFullName = prefix ? `${prefix}/${newBaseName.trim()}` : newBaseName.trim();
        const newTempId = `new:${newFullName}`;
        // Migrate cache entry
        const cached = await getCachedFile(item.id);
        await deleteCachedFile(item.id);
        await setCachedFile({
          fileId: newTempId,
          content: cached?.content ?? "",
          md5Checksum: "",
          modifiedTime: "",
          cachedAt: Date.now(),
          fileName: newFullName,
        });
        // Update tree node
        setTreeItems((prev) => {
          const replace = (nodes: CachedTreeNode[]): CachedTreeNode[] =>
            nodes.map((n) => {
              if (n.id === item.id) return { ...n, id: newTempId, name: newBaseName.trim() };
              if (n.children) return { ...n, children: replace(n.children) };
              return n;
            });
          return replace(prev);
        });
        // Update active file if it was the renamed file
        if (activeFileId === item.id) {
          onSelectFile(newTempId, newBaseName.trim(), item.mimeType);
        }
        return;
      }

      if (item.isFolder && item.id.startsWith("vfolder:")) {
        // Virtual folder rename: rename the path prefix in all contained files
        const oldPrefix = item.id.slice("vfolder:".length);
        const newFolderName = prompt(t("contextMenu.rename"), item.name);
        if (!newFolderName?.trim() || newFolderName.trim() === item.name) return;

        // Build the new prefix by replacing the last segment
        const parts = oldPrefix.split("/");
        parts[parts.length - 1] = newFolderName.trim();
        const newPrefix = parts.join("/");

        const fileIds = collectFileIds(item);
        setBusy(fileIds);
        try {
          let lastMeta: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] } | null = null;
          for (const fid of fileIds) {
            const fullName = findFullFileName(fid, treeItems, "");
            if (!fullName) continue;
            // Replace old prefix with new prefix
            const newFullName = newPrefix + fullName.slice(oldPrefix.length);
            const res = await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "rename",
                fileId: fid,
                name: newFullName,
              }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.meta) lastMeta = data.meta;
            }
          }
          if (lastMeta) {
            await updateTreeFromMeta(lastMeta);
          } else {
            await fetchAndCacheTree();
          }
        } catch {
          // ignore
        } finally {
          clearBusy(fileIds);
        }
        return;
      }

      // Regular file rename: preserve path prefix
      const currentFullName = findFullFileName(item.id, treeItems, "");
      const newBaseName = prompt(t("contextMenu.rename"), item.name);
      if (!newBaseName?.trim() || newBaseName.trim() === item.name) return;

      // Reconstruct full name with path prefix
      let newFullName: string;
      if (currentFullName && currentFullName.includes("/")) {
        const prefix = currentFullName.substring(0, currentFullName.lastIndexOf("/"));
        newFullName = `${prefix}/${newBaseName.trim()}`;
      } else {
        newFullName = newBaseName.trim();
      }

      setBusy([item.id]);
      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "rename",
            fileId: item.id,
            name: newFullName,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.meta) {
            await updateTreeFromMeta(data.meta);
          } else {
            await fetchAndCacheTree();
          }
        }
      } catch {
        // ignore
      } finally {
        clearBusy([item.id]);
      }
    },
    [fetchAndCacheTree, updateTreeFromMeta, t, collectFileIds, findFullFileName, treeItems, setBusy, clearBusy, activeFileId, onSelectFile]
  );

  const handleDelete = useCallback(
    async (item: CachedTreeNode) => {
      // new: prefix files are not yet on Drive — delete locally only
      if (!item.isFolder && item.id.startsWith("new:")) {
        if (!confirm(t("trash.softDeleteConfirm").replace("{name}", item.name))) return;
        await deleteCachedFile(item.id);
        await deleteEditHistoryEntry(item.id);
        setTreeItems((prev) => removeNodeFromTree(prev, item.id));
        return;
      }

      if (item.isFolder && item.id.startsWith("vfolder:")) {
        // Virtual folder: move all files within to trash
        const fileIds = collectFileIds(item);
        if (fileIds.length === 0) return;
        if (!confirm(t("trash.softDeleteFolderConfirm").replace("{count}", String(fileIds.length)).replace("{name}", item.name))) return;

        setBusy(fileIds);
        try {
          let lastMeta: { lastUpdatedAt: string; files: CachedRemoteMeta["files"] } | null = null;
          for (const fid of fileIds) {
            const res = await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete", fileId: fid }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.meta) lastMeta = data.meta;
              // Clean local caches
              await deleteCachedFile(fid);
              await removeLocalSyncMetaEntry(fid);
              await deleteEditHistoryEntry(fid);
            }
          }
          if (lastMeta) {
            await updateTreeFromMeta(lastMeta);
          } else {
            await fetchAndCacheTree();
          }
        } catch {
          // ignore
        } finally {
          clearBusy(fileIds);
        }
      } else {
        if (!confirm(t("trash.softDeleteConfirm").replace("{name}", item.name))) return;

        setBusy([item.id]);
        try {
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", fileId: item.id }),
          });
          if (res.ok) {
            // Clean local caches
            await deleteCachedFile(item.id);
            await removeLocalSyncMetaEntry(item.id);
            await deleteEditHistoryEntry(item.id);
            const data = await res.json();
            if (data.meta) {
              await updateTreeFromMeta(data.meta);
            } else {
              const updated = removeNodeFromTree(treeItems, item.id);
              setTreeItems(updated);
              await setCachedFileTree({
                id: "current",
                rootFolderId,
                items: updated,
                cachedAt: Date.now(),
              });
            }
          }
        } catch {
          // ignore
        } finally {
          clearBusy([item.id]);
        }
      }
    },
    [treeItems, rootFolderId, collectFileIds, fetchAndCacheTree, updateTreeFromMeta, t, setBusy, clearBusy]
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
        // Send cached content so server encrypts latest local edits (not stale Drive content)
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

  const handleDecrypt = useCallback(
    async (item: CachedTreeNode) => {
      if (!confirm(t("crypt.decryptConfirm"))) return;

      setBusy([item.id]);
      try {
        // Get encrypted content from cache or server
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

        // Decrypt on client side
        let password = cryptoCache.getPassword();
        if (!password) {
          const inputPw = prompt(t("crypt.enterPassword"));
          if (!inputPw) return;
          password = inputPw;
        }

        let plaintext: string;
        if (isEncryptedFile(encContent)) {
          try {
            plaintext = await decryptFileContent(encContent, password);
          } catch {
            alert(t("crypt.wrongPassword"));
            return;
          }
          // Password confirmed correct — cache it
          cryptoCache.setPassword(password);
        } else {
          plaintext = encContent;
        }

        // Send plaintext to server to update file and remove .encrypted
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

        // Update local cache with plaintext
        await deleteCachedFile(item.id);

        // Update tree
        if (data.meta) {
          await updateTreeFromMeta(data.meta);
        } else {
          await fetchAndCacheTree();
        }

        // Dispatch event so _index updates active file name
        // Note: meta is omitted because tree was already updated above;
        // the DriveFileTree event listener will skip updateTreeFromMeta when meta is absent.
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
    await setCachedFile({
      fileId,
      content: tempContent,
      md5Checksum: "",
      modifiedTime: tempSavedAt,
      cachedAt: Date.now(),
      fileName,
    });
    // If this is the currently open file, trigger a refresh
    if (fileId === activeFileId) {
      window.dispatchEvent(new CustomEvent("temp-file-downloaded", { detail: { fileId } }));
    }
    setTempDiffData(null);
  }, [tempDiffData, activeFileId]);

  const handleClearCache = useCallback(
    async (item: CachedTreeNode) => {
      if (!item.isFolder) {
        // Single file
        if (modifiedFiles.has(item.id)) {
          if (!confirm(t("contextMenu.clearCacheModified"))) return;
        }
        await deleteCachedFile(item.id);
        await deleteEditHistoryEntry(item.id);
        // Remove from localSyncMeta
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
        if (item.id === activeFileId) {
          location.reload();
        }
      } else {
        // Folder: collect all file IDs
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
        if (activeFileId && toDelete.includes(activeFileId)) {
          location.reload();
        }
      }
    },
    [modifiedFiles, cachedFiles, collectFileIds, t, activeFileId]
  );

  const handleDuplicate = useCallback(
    async (item: CachedTreeNode) => {
      if (item.isFolder) return;
      const currentFullName = findFullFileName(item.id, treeItems, "");
      if (!currentFullName) return;

      // Generate "name (copy).ext" style name
      const lastDot = currentFullName.lastIndexOf(".");
      const base = lastDot > 0 ? currentFullName.slice(0, lastDot) : currentFullName;
      const ext = lastDot > 0 ? currentFullName.slice(lastDot) : "";
      const newName = `${base} (copy)${ext}`;

      setBusy([item.id]);
      try {
        // Read content from cache or server
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
          // Add the new file to the tree directly
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
            // Insert into the correct parent folder
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
        }
      } catch {
        // ignore
      } finally {
        clearBusy([item.id]);
      }
    },
    [treeItems, findFullFileName, onSelectFile, setBusy, clearBusy]
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

      // Read local content from cache so unsaved edits are reflected
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
    [findFullFileName, treeItems, t, setBusy, clearBusy, updateTreeFromMeta, fetchAndCacheTree, onSelectFile]
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

      // Read local content from cache so unsaved edits are reflected
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
    [findFullFileName, treeItems, t, setBusy, clearBusy, updateTreeFromMeta, fetchAndCacheTree, onSelectFile]
  );

  const getContextMenuItems = useCallback(
    (item: CachedTreeNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];

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
            const a = document.createElement("a");
            a.href = `/api/drive/files?action=raw&fileId=${item.id}`;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          },
        });

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
        if (!item.name.endsWith(".encrypted")) {
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
        if (!item.name.endsWith(".encrypted")) {
          items.push({
            label: t("crypt.encrypt"),
            icon: <Lock size={ICON.MD} />,
            onClick: () => handleEncrypt(item),
          });
        } else {
          items.push({
            label: t("crypt.decrypt"),
            icon: <Unlock size={ICON.MD} />,
            onClick: () => handleDecrypt(item),
          });
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
        onClick: () => handleRename(item),
      });

      items.push({
        label: t("trash.tabTrash"),
        icon: <Trash2 size={ICON.MD} />,
        onClick: () => handleDelete(item),
        danger: true,
      });

      return items;
    },
    [handleDelete, handleRename, handleDuplicate, handleEncrypt, handleDecrypt, handleClearCache, handlePublish, handleUnpublish, handleCopyLink, handleConvertMarkdownToPdf, handleConvertMarkdownToHtml, remoteMeta, cachedFiles, collectFileIds, t, findFullFileName, treeItems]
  );

  const renderItem = (item: CachedTreeNode, depth: number, parentId: string) => {
    const isDragging = draggingItem?.id === item.id;

    if (item.isFolder) {
      const expanded = expandedFolders.has(item.id);
      const isDragOver = dragOverFolderId === item.id;
      const isVirtualFolder = item.id.startsWith("vfolder:");
      const isSelected = selectedFolderId === item.id;

      return (
        <div key={item.id}>
          <button
            draggable={!isVirtualFolder}
            onClick={() => toggleFolder(item.id)}
            onContextMenu={(e) => handleContextMenu(e, item)}
            onDragStart={(e) => {
              if (isVirtualFolder) { e.preventDefault(); return; }
              e.dataTransfer.setData("application/x-tree-node-id", item.id);
              e.dataTransfer.setData("application/x-tree-node-parent", parentId);
              e.dataTransfer.effectAllowed = "move";
              setDraggingItem({ id: item.id, parentId });
            }}
            onDragEnd={() => setDraggingItem(null)}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = draggingItem ? "move" : "copy";
            }}
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
              {item.name}
            </span>
            {isMobile && (
              <span
                className="ml-auto flex-shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                onClick={(e) => { e.stopPropagation(); handleContextMenu(e as unknown as React.MouseEvent, item); }}
              >
                <MoreHorizontal size={ICON.MD} />
              </span>
            )}
          </button>
          {expanded &&
            item.children?.map((child) => renderItem(child, depth + 1, item.id))}
        </div>
      );
    }

    const isActive = item.id === activeFileId;

    return (
      <button
        key={item.id}
        draggable
        onClick={() => { setSelectedFolderId(null); onSelectFile(item.id, item.name, item.mimeType); }}
        onContextMenu={(e) => handleContextMenu(e, item)}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-tree-node-id", item.id);
          e.dataTransfer.setData("application/x-tree-node-parent", parentId);
          e.dataTransfer.effectAllowed = "move";
          setDraggingItem({ id: item.id, parentId });
        }}
        onDragEnd={() => setDraggingItem(null)}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm ${
          isActive
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
      onDragOver={handleTreeDragOver}
      onDragEnter={handleTreeDragEnter}
      onDragLeave={handleTreeDragLeave}
      onDrop={(e) => handleDrop(e, rootFolderId)}
    >
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Files
        </span>
        <div className="flex items-center gap-0.5">
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
      <div className="flex-1 overflow-y-auto py-1">
        {loading && treeItems.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={ICON.LG} className="animate-spin text-gray-400" />
          </div>
        ) : treeItems.length === 0 ? (
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
          treeItems.map((item) => renderItem(item, 0, rootFolderId))
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

      {createFileDialog.open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCreateFileDialog((prev) => ({ ...prev, open: false }))}>
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
