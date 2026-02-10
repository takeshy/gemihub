import { useState, useCallback, useEffect, useRef } from "react";
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
  Globe,
  GlobeLock,
  Copy,
  Search,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
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
  getLocalSyncMeta,
  setLocalSyncMeta,
  type CachedTreeNode,
  type CachedRemoteMeta,
} from "~/services/indexeddb-cache";
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
  const [editHistoryFile, setEditHistoryFile] = useState<{ fileId: string; filePath: string } | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [cachedFiles, setCachedFiles] = useState<Set<string>>(new Set());
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [createFileDialog, setCreateFileDialog] = useState<{
    open: boolean; name: string; ext: string; customExt: string;
  }>({ open: false, name: "", ext: ".md", customExt: "" });
  const [decryptTarget, setDecryptTarget] = useState<CachedTreeNode | null>(null);
  const [decryptPassword, setDecryptPassword] = useState("");
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
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
  const { t } = useI18n();
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
    window.addEventListener("file-modified", handleModified);
    window.addEventListener("file-cached", handleCached);
    window.addEventListener("sync-complete", syncHandler);
    return () => {
      window.removeEventListener("file-modified", handleModified);
      window.removeEventListener("file-cached", handleCached);
      window.removeEventListener("sync-complete", syncHandler);
    };
  }, [fetchAndCacheTree]);

  // Push flattened file list to parent when tree changes
  useEffect(() => {
    if (onFileListChange && treeItems.length > 0) {
      onFileListChange(flattenTree(treeItems, ""));
    }
  }, [treeItems, onFileListChange]);

  // Load: IndexedDB cache first (meta or tree), then server in background
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Try cached meta first (more accurate), then cached tree
      const cachedMeta = await getCachedRemoteMeta();
      if (!cancelled && cachedMeta && cachedMeta.rootFolderId === rootFolderId) {
        setTreeItems(buildTreeFromMeta(cachedMeta));
        setRemoteMeta(cachedMeta.files);
        setLoading(false);
      } else {
        const cached = await getCachedFileTree();
        if (!cancelled && cached && cached.rootFolderId === rootFolderId) {
          setTreeItems(cached.items);
          setLoading(false);
        }
      }
      // Always refresh from server in background
      if (!cancelled) {
        await fetchAndCacheTree();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rootFolderId, fetchAndCacheTree]);

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

  const handleCreateFileSubmit = useCallback(async () => {
    const name = createFileDialog.name.trim();
    if (!name) return;
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

    try {
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: fullName,
          content: "",
          mimeType: "text/plain",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onSelectFile(data.file.id, data.file.name, data.file.mimeType);
        // Expand parent folder
        if (selectedFolderId) {
          setExpandedFolders((prev) => new Set(prev).add(selectedFolderId));
        }
        // Update tree from returned meta (no server roundtrip needed)
        if (data.meta) {
          await updateTreeFromMeta(data.meta);
        } else {
          await fetchAndCacheTree();
        }
      }
    } catch {
      // ignore
    }
  }, [createFileDialog, selectedFolderId, fetchAndCacheTree, updateTreeFromMeta, onSelectFile, treeItems, t]);

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
      }
    },
    [treeItems, rootFolderId, fetchAndCacheTree, updateTreeFromMeta, findFullFileName, getFolderPath]
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

      const success = await upload(files, rootFolderId, namePrefix);
      if (success) {
        // Expand folder if dropping into a subfolder
        if (folderId !== rootFolderId) {
          setExpandedFolders((prev) => new Set(prev).add(folderId));
        }
        await fetchAndCacheTree();
      }
    },
    [upload, rootFolderId, fetchAndCacheTree, handleMoveItem, getFolderPath, treeItems, t]
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
      }
    },
    [fetchAndCacheTree, updateTreeFromMeta, t, collectFileIds, findFullFileName, treeItems]
  );

  const handleDelete = useCallback(
    async (item: CachedTreeNode) => {
      if (item.isFolder && item.id.startsWith("vfolder:")) {
        // Virtual folder: move all files within to trash
        const fileIds = collectFileIds(item);
        if (fileIds.length === 0) return;
        if (!confirm(t("trash.softDeleteFolderConfirm").replace("{count}", String(fileIds.length)).replace("{name}", item.name))) return;

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
            }
            // Clean local caches
            await deleteCachedFile(fid);
          }
          if (lastMeta) {
            await updateTreeFromMeta(lastMeta);
          } else {
            await fetchAndCacheTree();
          }
        } catch {
          // ignore
        }
      } else {
        if (!confirm(t("trash.softDeleteConfirm").replace("{name}", item.name))) return;

        try {
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", fileId: item.id }),
          });
          if (res.ok) {
            // Clean local caches
            await deleteCachedFile(item.id);
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
        }
      }
    },
    [treeItems, rootFolderId, collectFileIds, fetchAndCacheTree, updateTreeFromMeta, t]
  );

  const handleEncrypt = useCallback(
    async (item: CachedTreeNode) => {
      if (!encryptionEnabled) {
        alert("暗号化が未設定です。設定画面から暗号化を設定してください。");
        window.location.href = "/settings";
        return;
      }

      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "encrypt",
            fileId: item.id,
          }),
        });
        if (res.ok) {
          const data = await res.json();
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
      }
    },
    [fetchAndCacheTree, updateTreeFromMeta, encryptionEnabled]
  );

  const handleDecrypt = useCallback(
    (item: CachedTreeNode) => {
      if (!encryptionEnabled) {
        alert("暗号化が未設定です。設定画面から暗号化を設定してください。");
        window.location.href = "/settings";
        return;
      }
      setDecryptTarget(item);
      setDecryptPassword("");
      setDecryptError(null);
    },
    [encryptionEnabled]
  );

  const handleDecryptSubmit = useCallback(async () => {
    if (!decryptTarget || !decryptPassword) return;
    setDecrypting(true);
    setDecryptError(null);
    try {
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decrypt",
          fileId: decryptTarget.id,
          password: decryptPassword,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDecryptTarget(null);
        if (data.meta) {
          await updateTreeFromMeta(data.meta);
        } else {
          await fetchAndCacheTree();
        }
      } else {
        const data = await res.json();
        setDecryptError(data.error || t("crypt.wrongPassword"));
      }
    } catch {
      setDecryptError(t("crypt.wrongPassword"));
    } finally {
      setDecrypting(false);
    }
  }, [decryptTarget, decryptPassword, fetchAndCacheTree, updateTreeFromMeta, t]);

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
      }
    },
    [modifiedFiles, cachedFiles, collectFileIds, t]
  );

  const handlePublish = useCallback(
    async (item: CachedTreeNode) => {
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
      }
    },
    [updateTreeFromMeta, t]
  );

  const handleUnpublish = useCallback(
    async (item: CachedTreeNode) => {
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
      }
    },
    [updateTreeFromMeta, t]
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

  const getContextMenuItems = useCallback(
    (item: CachedTreeNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];

      if (!item.isFolder) {
        if (item.name.endsWith(".encrypted")) {
          items.push({
            label: "Decrypt",
            icon: <Unlock size={ICON.MD} />,
            onClick: () => handleDecrypt(item),
          });
        } else {
          items.push({
            label: "Encrypt",
            icon: <Lock size={ICON.MD} />,
            onClick: () => handleEncrypt(item),
          });
        }

        items.push({
          label: t("editHistory.menuLabel"),
          icon: <History size={ICON.MD} />,
          onClick: () => setEditHistoryFile({ fileId: item.id, filePath: item.name }),
        });

        items.push({
          label: t("contextMenu.download"),
          icon: <Download size={ICON.MD} />,
          onClick: async () => {
            const fileName = item.name.split("/").pop() || item.name;
            const cached = await getCachedFile(item.id);
            if (cached) {
              const blob = new Blob([cached.content], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } else {
              const a = document.createElement("a");
              a.href = `/api/drive/files?action=raw&fileId=${item.id}`;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
          },
        });

        // Publish / unpublish — not for encrypted files
        if (!item.name.endsWith(".encrypted")) {
          const fileMeta = remoteMeta[item.id];
          if (fileMeta?.shared) {
            items.push({
              label: t("contextMenu.copyLink"),
              icon: <Copy size={ICON.MD} />,
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
      }

      // Cache clear - available for both files and folders
      if (!item.isFolder && cachedFiles.has(item.id)) {
        items.push({
          label: t("contextMenu.clearCache"),
          icon: <Eraser size={ICON.MD} />,
          onClick: () => handleClearCache(item),
        });
      } else if (item.isFolder) {
        items.push({
          label: t("contextMenu.clearCache"),
          icon: <Eraser size={ICON.MD} />,
          onClick: () => handleClearCache(item),
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
    [handleDelete, handleRename, handleEncrypt, handleDecrypt, handleClearCache, handlePublish, handleUnpublish, handleCopyLink, remoteMeta, cachedFiles, t]
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
            {expanded ? (
              <FolderOpen size={ICON.MD} className="text-yellow-500 flex-shrink-0" />
            ) : (
              <Folder size={ICON.MD} className="text-yellow-500 flex-shrink-0" />
            )}
            <span className="truncate text-gray-700 dark:text-gray-300">
              {item.name}
            </span>
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
        {getFileIcon(item.name, item.mimeType)}
        <span className="truncate">{item.name}</span>
        {remoteMeta[item.id]?.shared && (
          <span
            className="ml-auto flex-shrink-0 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
            title={`${window.location.origin}/public/file/${item.id}/${encodeURIComponent(item.name)}`}
            onClick={(e) => { e.stopPropagation(); handleCopyLink(item.id); }}
          >
            <Globe size={ICON.SM} />
          </span>
        )}
        {modifiedFiles.has(item.id) ? (
          <span className={`${remoteMeta[item.id]?.shared ? "" : "ml-auto "}w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0`} title="Modified" />
        ) : cachedFiles.has(item.id) ? (
          <span className={`${remoteMeta[item.id]?.shared ? "" : "ml-auto "}w-2 h-2 rounded-full bg-green-500 flex-shrink-0`} title="Cached" />
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
          onClose={() => setEditHistoryFile(null)}
        />
      )}

      {decryptTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !decrypting && setDecryptTarget(null)}>
          <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              {t("crypt.enterPassword")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 truncate">
              {decryptTarget.name}
            </p>
            <input
              type="password"
              value={decryptPassword}
              onChange={(e) => { setDecryptPassword(e.target.value); setDecryptError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleDecryptSubmit(); }}
              placeholder={t("crypt.passwordPlaceholder")}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
              disabled={decrypting}
            />
            {decryptError && (
              <p className="text-xs text-red-500 mt-1">{decryptError}</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setDecryptTarget(null)}
                disabled={decrypting}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDecryptSubmit}
                disabled={!decryptPassword || decrypting}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {decrypting ? t("crypt.decrypting") : t("crypt.unlock")}
              </button>
            </div>
          </div>
        </div>
      )}

      {createFileDialog.open && (
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
                  placeholder="filename"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div className="w-24">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("fileTree.extension")}</label>
                <select
                  value={createFileDialog.ext}
                  onChange={(e) => setCreateFileDialog((prev) => ({ ...prev, ext: e.target.value }))}
                  className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value=".md">.md</option>
                  <option value=".yaml">.yaml</option>
                  <option value=".json">.json</option>
                  <option value=".html">.html</option>
                  <option value=".txt">.txt</option>
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
                    className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                disabled={!createFileDialog.name.trim() || (createFileDialog.ext === "custom" && !createFileDialog.customExt.trim())}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {t("fileTree.create")}
              </button>
            </div>
          </div>
        </div>
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
