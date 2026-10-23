import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronRight, Folder, FolderInput, Loader2, X } from "lucide-react";
import type { CachedTreeNode } from "~/services/indexeddb-cache";
import { useI18n } from "~/i18n/context";
import { findFullFileName, findNodeById, getMoveTargetIssue } from "~/utils/tree-helpers";
import { ICON } from "~/utils/icon-sizes";

interface MoveToFolderDialogProps {
  item: CachedTreeNode;
  treeItems: CachedTreeNode[];
  rootFolderId: string;
  onMove: (folderId: string) => Promise<void>;
  onClose: () => void;
}

export function MoveToFolderDialog({ item, treeItems, rootFolderId, onMove, onClose }: MoveToFolderDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [currentFolderId, setCurrentFolderId] = useState(() => {
    const fullPath = findFullFileName(item.id, treeItems, "") ?? item.name;
    const parentPath = fullPath.includes("/") ? fullPath.slice(0, fullPath.lastIndexOf("/")) : "";
    return parentPath ? `vfolder:${parentPath}` : rootFolderId;
  });
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const currentFolder = currentFolderId === rootFolderId ? null : findNodeById(currentFolderId, treeItems);
  const currentPath = currentFolder ? findFullFileName(currentFolder.id, treeItems, "") ?? "" : "";
  const parts = currentPath ? currentPath.split("/") : [];
  const folders = (currentFolder ? currentFolder.children ?? [] : treeItems).filter((node) => node.isFolder);
  const targetId = selectedFolderId ?? currentFolderId;
  const targetPath = targetId === rootFolderId ? "/" : findFullFileName(targetId, treeItems, "") ?? "/";
  const issue = getMoveTargetIssue(treeItems, item.id, targetId, rootFolderId);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const navigate = (folderId: string) => {
    setCurrentFolderId(folderId);
    setSelectedFolderId(null);
  };
  const goUp = () => navigate(parts.length > 1 ? `vfolder:${parts.slice(0, -1).join("/")}` : rootFolderId);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="move-folder-title"
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-lg bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/50 dark:bg-gray-900 dark:text-gray-100"
      onCancel={(e) => { e.preventDefault(); if (!moving) onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !moving) onClose(); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.altKey && e.key === "ArrowUp" && currentPath && !moving) {
          e.preventDefault();
          goUp();
        }
      }}
    >
      <div className="flex max-h-[85dvh] flex-col" aria-busy={moving}>
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <FolderInput size={ICON.MD} className="shrink-0 text-blue-500" />
          <h2 id="move-folder-title" className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t("fileTree.moveTitle").replace("{name}", item.name)}
          </h2>
          <button type="button" onClick={onClose} disabled={moving} aria-label={t("common.cancel")} className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800">
            <X size={ICON.MD} />
          </button>
        </div>
        <fieldset disabled={moving} className="min-h-0 min-w-0 flex-1">
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <button type="button" onClick={goUp} disabled={!currentPath} title={t("fileTree.parentFolder")} aria-label={t("fileTree.parentFolder")} className="rounded p-1.5 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800">
              <ArrowUp size={ICON.MD} />
            </button>
            <nav aria-label={t("fileTree.moveDestination")} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700">
              <button type="button" onClick={() => navigate(rootFolderId)} className="shrink-0 rounded px-1 hover:bg-gray-100 dark:hover:bg-gray-800">{t("dashboard.root")}</button>
              {parts.map((part, index) => {
                const path = parts.slice(0, index + 1).join("/");
                return <span key={path} className="flex shrink-0 items-center gap-1">
                  <ChevronRight size={ICON.SM} className="text-gray-400" />
                  <button type="button" onClick={() => navigate(`vfolder:${path}`)} className="rounded px-1 hover:bg-gray-100 dark:hover:bg-gray-800">{part}</button>
                </span>;
              })}
            </nav>
          </div>
          <p className="px-4 pt-3 text-xs text-gray-500 dark:text-gray-400">{t("fileTree.moveHint")}</p>
          <ul aria-label={t("dashboard.browseFolders")} className="h-60 overflow-y-auto p-2">
            {folders.map((folder) => {
              const blocked = getMoveTargetIssue(treeItems, item.id, folder.id, rootFolderId) === "descendant";
              const selected = selectedFolderId === folder.id;
              return <li key={folder.id} className={`flex rounded ${selected ? "bg-blue-100 dark:bg-blue-900/40" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                <button
                  type="button"
                  disabled={blocked}
                  aria-pressed={selected}
                  onClick={() => setSelectedFolderId(folder.id)}
                  onDoubleClick={() => navigate(folder.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "ArrowRight") {
                      e.preventDefault();
                      navigate(folder.id);
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-3 py-2 text-left text-sm disabled:opacity-35"
                >
                  <Folder size={ICON.MD} className="shrink-0 text-yellow-500" />
                  <span className="truncate">{folder.name}</span>
                </button>
                <button type="button" disabled={blocked} onClick={() => navigate(folder.id)} aria-label={t("fileTree.openFolder").replace("{name}", folder.name)} className="rounded px-2 text-gray-500 hover:bg-gray-200 disabled:opacity-35 dark:hover:bg-gray-700">
                  <ChevronRight size={ICON.MD} />
                </button>
              </li>;
            })}
            {folders.length === 0 && <li className="px-3 py-8 text-center text-sm text-gray-400">{t("dashboard.noSubfolders")}</li>}
          </ul>
        </fieldset>
        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex gap-2 text-sm"><span className="shrink-0 text-gray-500 dark:text-gray-400">{t("fileTree.moveDestination")}</span><span title={targetPath} className="min-w-0 truncate">{targetPath}</span></div>
          <p role="status" className="mt-1 h-10 text-xs text-gray-500 dark:text-gray-400 sm:h-8">{issue && (
            issue === "sameFolder" ? t("fileTree.moveSameFolder")
              : issue === "descendant" ? t("fileTree.moveDescendant")
                : issue === "nameConflict" ? t("fileTree.moveNameConflict")
                  : t("contextMenu.moveFailed")
          )}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" autoFocus disabled={moving} onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800">{t("common.cancel")}</button>
            <button
              type="button"
              disabled={moving || issue !== null}
              onClick={async () => {
                setMoving(true);
                try { await onMove(targetId); onClose(); }
                finally { setMoving(false); }
              }}
              className="flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {moving && <Loader2 size={ICON.SM} className="animate-spin" />}
              {t("fileTree.moveHere")}
            </button>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
