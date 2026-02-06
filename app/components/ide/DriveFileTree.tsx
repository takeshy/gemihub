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
  RefreshCw,
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
  Download,
} from "lucide-react";
import {
  getCachedFileTree,
  setCachedFileTree,
  setCachedFile,
  type CachedTreeNode,
} from "~/services/indexeddb-cache";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useFileUpload } from "~/hooks/useFileUpload";
import { EditHistoryModal } from "./EditHistoryModal";
import { useI18n } from "~/i18n/context";
import type { FileListItem } from "~/contexts/EditorContext";

interface DriveFileTreeProps {
  rootFolderId: string;
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  activeFileId: string | null;
  encryptionEnabled: boolean;
  onFileListChange?: (items: FileListItem[]) => void;
}

function getFileIcon(name: string, _mimeType: string) {
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    return <FileCode size={14} className="text-orange-500 flex-shrink-0" />;
  }
  if (name.endsWith(".md")) {
    return <FileText size={14} className="text-blue-500 flex-shrink-0" />;
  }
  if (name.endsWith(".json")) {
    return <FileJson size={14} className="text-yellow-500 flex-shrink-0" />;
  }
  return <File size={14} className="text-gray-400 flex-shrink-0" />;
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

function isDescendant(
  nodes: CachedTreeNode[],
  ancestorId: string,
  targetId: string
): boolean {
  for (const node of nodes) {
    if (node.id === ancestorId && node.isFolder && node.children) {
      return findInChildren(node.children, targetId);
    }
    if (node.children && isDescendant(node.children, ancestorId, targetId)) {
      return true;
    }
  }
  return false;
}

function findInChildren(
  nodes: CachedTreeNode[],
  targetId: string
): boolean {
  for (const node of nodes) {
    if (node.id === targetId) return true;
    if (node.children && findInChildren(node.children, targetId)) return true;
  }
  return false;
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

export function DriveFileTree({
  rootFolderId,
  onSelectFile,
  activeFileId,
  encryptionEnabled,
  onFileListChange,
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
  const [editHistoryFile, setEditHistoryFile] = useState<string | null>(null);
  const { t } = useI18n();
  const dragCounterRef = useRef(0);
  const folderDragCounterRef = useRef<Map<string, number>>(new Map());
  const { uploading, progress, upload, clearProgress } = useFileUpload();

  const fetchAndCacheTree = useCallback(async () => {
    try {
      const res = await fetch(`/api/drive/tree?folderId=${rootFolderId}&isRoot=true`);
      if (!res.ok) return;
      const data = await res.json();
      const items = data.items as CachedTreeNode[];
      setTreeItems(items);
      await setCachedFileTree({
        id: "current",
        rootFolderId,
        items,
        cachedAt: Date.now(),
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [rootFolderId]);

  // Push flattened file list to parent when tree changes
  useEffect(() => {
    if (onFileListChange && treeItems.length > 0) {
      onFileListChange(flattenTree(treeItems, ""));
    }
  }, [treeItems, onFileListChange]);

  // Load: IndexedDB first, then server in background
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await getCachedFileTree();
      if (!cancelled && cached && cached.rootFolderId === rootFolderId) {
        setTreeItems(cached.items);
        setLoading(false);
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

  const handleRefresh = useCallback(() => {
    setLoading(true);
    fetchAndCacheTree();
  }, [fetchAndCacheTree]);

  const handleCreateFolder = useCallback(async () => {
    const name = prompt("Folder name:");
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createFolder",
          name: name.trim(),
          folderId: rootFolderId,
        }),
      });
      if (res.ok) {
        await fetchAndCacheTree();
      }
    } catch {
      // ignore
    }
  }, [rootFolderId, fetchAndCacheTree]);

  const handleCreateFile = useCallback(async () => {
    const name = prompt("File name (e.g. notes.md):");
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          content: "",
          folderId: rootFolderId,
          mimeType: "text/plain",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onSelectFile(data.file.id, data.file.name, data.file.mimeType);
        await fetchAndCacheTree();
      }
    } catch {
      // ignore
    }
  }, [rootFolderId, fetchAndCacheTree, onSelectFile]);

  // Auto-clear progress after 3 seconds when all done
  useEffect(() => {
    if (progress.length === 0) return;
    const allDone = progress.every((p) => p.status !== "uploading");
    if (!allDone) return;
    const timer = setTimeout(() => clearProgress(), 3000);
    return () => clearTimeout(timer);
  }, [progress, clearProgress]);

  const handleMoveItem = useCallback(
    async (itemId: string, oldParentId: string, newParentId: string) => {
      // Don't move to same parent
      if (oldParentId === newParentId) return;
      // Don't drop on self
      if (itemId === newParentId) return;
      // Don't drop folder into its own descendant
      if (isDescendant(treeItems, itemId, newParentId)) return;

      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move",
            fileId: itemId,
            newParentId,
            oldParentId,
          }),
        });
        if (res.ok) {
          if (newParentId !== rootFolderId) {
            setExpandedFolders((prev) => new Set(prev).add(newParentId));
          }
          await fetchAndCacheTree();
        }
      } catch {
        // ignore
      }
    },
    [treeItems, rootFolderId, fetchAndCacheTree]
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

      const success = await upload(files, folderId);
      if (success) {
        // Expand folder if dropping into a subfolder
        if (folderId !== rootFolderId) {
          setExpandedFolders((prev) => new Set(prev).add(folderId));
        }
        await fetchAndCacheTree();
      }
    },
    [upload, rootFolderId, fetchAndCacheTree, handleMoveItem]
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

  const handleRename = useCallback(
    async (item: CachedTreeNode) => {
      const newName = prompt(t("contextMenu.rename"), item.name);
      if (!newName?.trim() || newName.trim() === item.name) return;

      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "rename",
            fileId: item.id,
            name: newName.trim(),
          }),
        });
        if (res.ok) {
          await fetchAndCacheTree();
        }
      } catch {
        // ignore
      }
    },
    [fetchAndCacheTree, t]
  );

  const handleDelete = useCallback(
    async (item: CachedTreeNode) => {
      const typeLabel = item.isFolder ? "folder" : "file";
      if (!confirm(`Delete ${typeLabel} "${item.name}"?`)) return;

      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", fileId: item.id }),
        });
        if (res.ok) {
          const updated = removeNodeFromTree(treeItems, item.id);
          setTreeItems(updated);
          await setCachedFileTree({
            id: "current",
            rootFolderId,
            items: updated,
            cachedAt: Date.now(),
          });
        }
      } catch {
        // ignore
      }
    },
    [treeItems, rootFolderId]
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
          await fetchAndCacheTree();
        } else {
          const data = await res.json();
          alert(data.error || "Encryption failed");
        }
      } catch {
        alert("Encryption failed");
      }
    },
    [fetchAndCacheTree, encryptionEnabled]
  );

  const handleDecrypt = useCallback(
    async (item: CachedTreeNode) => {
      if (!encryptionEnabled) {
        alert("暗号化が未設定です。設定画面から暗号化を設定してください。");
        window.location.href = "/settings";
        return;
      }

      const password = prompt("復号パスワードを入力してください:");
      if (!password) return;

      try {
        const res = await fetch("/api/drive/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "decrypt",
            fileId: item.id,
            password,
          }),
        });
        if (res.ok) {
          await fetchAndCacheTree();
        } else {
          const data = await res.json();
          alert(data.error || "Decryption failed");
        }
      } catch {
        alert("Decryption failed");
      }
    },
    [fetchAndCacheTree, encryptionEnabled]
  );

  const handleClearHistory = useCallback(
    async (item: CachedTreeNode) => {
      if (!confirm(t("editHistory.confirmClear"))) return;
      try {
        await fetch("/api/settings/edit-history", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: item.name }),
        });
      } catch {
        // ignore
      }
    },
    [t]
  );

  const handleTempDownload = useCallback(
    async (item: CachedTreeNode) => {
      try {
        const res = await fetch("/api/drive/temp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "download", fileName: item.name }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.found) {
          alert(t("contextMenu.noTempFile"));
          return;
        }
        const { payload } = data.tempFile;
        await setCachedFile({
          fileId: payload.fileId,
          content: payload.content,
          md5Checksum: "",
          modifiedTime: payload.savedAt,
          cachedAt: Date.now(),
          fileName: item.name,
        });
        // If this is the currently open file, trigger a refresh
        if (payload.fileId === activeFileId) {
          window.dispatchEvent(new CustomEvent("temp-file-downloaded", { detail: { fileId: payload.fileId } }));
        }
      } catch {
        // ignore
      }
    },
    [activeFileId, t]
  );

  const getContextMenuItems = useCallback(
    (item: CachedTreeNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];

      if (!item.isFolder) {
        if (item.name.endsWith(".encrypted")) {
          items.push({
            label: "Decrypt",
            icon: <Unlock size={14} />,
            onClick: () => handleDecrypt(item),
          });
        } else {
          items.push({
            label: "Encrypt",
            icon: <Lock size={14} />,
            onClick: () => handleEncrypt(item),
          });
        }

        items.push({
          label: t("contextMenu.tempDownload"),
          icon: <Download size={14} />,
          onClick: () => handleTempDownload(item),
        });
        items.push({
          label: t("editHistory.menuLabel"),
          icon: <History size={14} />,
          onClick: () => setEditHistoryFile(item.name),
        });
        items.push({
          label: t("editHistory.clearHistory"),
          icon: <Trash2 size={14} />,
          onClick: () => handleClearHistory(item),
          danger: true,
        });
      }

      items.push({
        label: t("contextMenu.rename"),
        icon: <Pencil size={14} />,
        onClick: () => handleRename(item),
      });

      items.push({
        label: "Delete",
        icon: <Trash2 size={14} />,
        onClick: () => handleDelete(item),
        danger: true,
      });

      return items;
    },
    [encryptionEnabled, handleDelete, handleRename, handleEncrypt, handleDecrypt, handleClearHistory, handleTempDownload, t]
  );

  const renderItem = (item: CachedTreeNode, depth: number, parentId: string) => {
    const isDragging = draggingItem?.id === item.id;

    if (item.isFolder) {
      const expanded = expandedFolders.has(item.id);
      const isDragOver = dragOverFolderId === item.id;

      return (
        <div key={item.id}>
          <button
            draggable
            onClick={() => toggleFolder(item.id)}
            onContextMenu={(e) => handleContextMenu(e, item)}
            onDragStart={(e) => {
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
            className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs ${
              isDragOver
                ? "bg-blue-100 ring-1 ring-blue-400 dark:bg-blue-900/40 dark:ring-blue-500"
                : "hover:bg-gray-100 dark:hover:bg-gray-800"
            } ${isDragging ? "opacity-50" : ""}`}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            {expanded ? (
              <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />
            )}
            {expanded ? (
              <FolderOpen size={14} className="text-yellow-500 flex-shrink-0" />
            ) : (
              <Folder size={14} className="text-yellow-500 flex-shrink-0" />
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
        onClick={() => onSelectFile(item.id, item.name, item.mimeType)}
        onContextMenu={(e) => handleContextMenu(e, item)}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-tree-node-id", item.id);
          e.dataTransfer.setData("application/x-tree-node-parent", parentId);
          e.dataTransfer.effectAllowed = "move";
          setDraggingItem({ id: item.id, parentId });
        }}
        onDragEnd={() => setDraggingItem(null)}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs ${
          isActive
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        } ${isDragging ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        {getFileIcon(item.name, item.mimeType)}
        <span className="truncate">{item.name}</span>
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
          <button
            onClick={handleCreateFile}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="New File"
          >
            <FilePlus size={14} />
          </button>
          <button
            onClick={handleCreateFolder}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="New Folder"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={handleRefresh}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading && treeItems.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-gray-400" />
          </div>
        ) : treeItems.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-gray-400">
            {dragOverTree ? (
              <div className="flex flex-col items-center gap-1">
                <Upload size={20} className="text-blue-400" />
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
                  size={12}
                  className="animate-spin text-blue-500 flex-shrink-0"
                />
              )}
              {p.status === "done" && (
                <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />
              )}
              {p.status === "error" && (
                <XCircle size={12} className="text-red-500 flex-shrink-0" />
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
          filePath={editHistoryFile}
          onClose={() => setEditHistoryFile(null)}
        />
      )}
    </div>
  );
}
