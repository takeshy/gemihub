/**
 * My Drive shelf — shown above the project FileTree while an org project is
 * selected. Presents the user's own Google Drive in the slot the fork used
 * for "personal projects": glance at Drive files, drag them into the
 * project, or drag project files out to Drive. Both directions COPY
 * (/api/storage/move-between-mounts with mode "copy"): the source keeps its
 * file, so a drag can never delete anything.
 *
 * Converted from the fork's PersonalStorageShelf; the personal project is
 * replaced by the "drive" mount.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, FolderOpen, HardDrive, Loader2 } from "lucide-react";
import { useEnterpriseContext } from "~/contexts/EnterpriseContext";
import { useI18n } from "~/i18n/context";
import type { CachedTreeNode } from "~/types/tree";
import {
  parseStorageDragPayload,
  STORAGE_DRAG_MIME,
  type StorageDragPayload,
} from "~/types/storage-drag";
import { collectFileIds } from "~/utils/tree-helpers";
import { ICON } from "~/utils/icon-sizes";

function folderMoves(item: CachedTreeNode): StorageDragPayload["moves"] {
  const folderPath = item.id.startsWith("vfolder:")
    ? item.id.slice("vfolder:".length)
    : item.name;
  const parentPath = folderPath.includes("/")
    ? folderPath.slice(0, folderPath.lastIndexOf("/"))
    : "";
  return collectFileIds(item).map((path) => ({
    from: path,
    to: parentPath && path.startsWith(`${parentPath}/`)
      ? path.slice(parentPath.length + 1)
      : path,
  }));
}

export function DriveShelf() {
  const { t } = useI18n();
  const { selection, currentOrgId, currentProjectId } = useEnterpriseContext();
  const [items, setItems] = useState<CachedTreeNode[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driveUnavailable, setDriveUnavailable] = useState(false);

  // The shelf only renders on a project mount; never fetch Drive otherwise.
  const shelfActive = !!(currentOrgId && currentProjectId && selection);

  const load = useCallback(async () => {
    if (!shelfActive) return;
    try {
      const treeResponse = await fetch(`/api/storage/tree?${new URLSearchParams({ mount: "drive" })}`);
      if (treeResponse.status === 401 || treeResponse.status === 403) {
        // Session has no Drive grant (OIDC/email login) — offer nothing here;
        // the user can connect via Google login.
        setDriveUnavailable(true);
        setItems([]);
        setError(null);
        return;
      }
      if (!treeResponse.ok) throw new Error(`HTTP ${treeResponse.status}`);
      const treeData = await treeResponse.json() as { items: CachedTreeNode[] };
      setDriveUnavailable(false);
      setItems(treeData.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("driveShelf.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [shelfActive, t]);

  useEffect(() => {
    if (!shelfActive) return;
    setLoading(true);
    void load();
  }, [load, shelfActive]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("drive-shelf-changed", refresh);
    return () => window.removeEventListener("drive-shelf-changed", refresh);
  }, [load]);

  const fileCount = useMemo(
    () => items.reduce((count, item) => count + (item.isFolder ? collectFileIds(item).length : 1), 0),
    [items],
  );

  async function openDrive() {
    // Deselect the project — the IDE falls back to the Drive mount.
    const response = await fetch("/api/session/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: null }),
    });
    if (response.ok) window.location.reload();
  }

  function startDrag(event: React.DragEvent, item: CachedTreeNode) {
    const moves = item.isFolder
      ? folderMoves(item)
      : [{ from: item.id, to: item.id.split("/").pop() || item.name }];
    if (moves.length === 0) return;
    const payload: StorageDragPayload = { sourceMount: "drive", moves };
    event.dataTransfer.setData(STORAGE_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
  }

  async function dropIntoDrive(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const payload = parseStorageDragPayload(event.dataTransfer.getData(STORAGE_DRAG_MIME));
    if (!payload || payload.sourceMount === "drive") return;
    try {
      const response = await fetch("/api/storage/move-between-mounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMount: payload.sourceMount,
          targetMount: "drive",
          moves: payload.moves,
          // Copy: the project keeps its file. Dragging out of a shared project
          // must never be a one-gesture deletion.
          mode: "copy",
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? `HTTP ${response.status}`);
      }
      // The source project keeps its files, so its cache stays as it is.
      await load();
      window.dispatchEvent(new Event("drive-shelf-changed"));
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : t("driveShelf.copyFailed"));
    }
  }

  function renderNode(item: CachedTreeNode, depth = 0): React.ReactNode {
    return (
      <div key={item.id}>
        <button
          type="button"
          draggable={!loading}
          onDragStart={(event) => startDrag(event, item)}
          onDoubleClick={() => void openDrive()}
          className="flex w-full items-center gap-1 rounded py-0.5 pr-1 text-left text-xs text-amber-950 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          title={t("driveShelf.openHint")}
        >
          {item.isFolder
            ? <FolderOpen size={ICON.SM} className="shrink-0 text-amber-600 dark:text-amber-400" />
            : <File size={ICON.SM} className="shrink-0 text-amber-500" />}
          <span className="truncate">{item.name}</span>
        </button>
        {item.isFolder && item.children?.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  // The shelf appears only while an org project is the main workspace.
  if (!shelfActive) return null;

  return (
    <section
      className={`shrink-0 border-b border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/25 ${
        dragOver ? "ring-2 ring-inset ring-amber-400" : ""
      }`}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes(STORAGE_DRAG_MIME)) setDragOver(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(STORAGE_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(event) => void dropIntoDrive(event)}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-amber-900 dark:text-amber-100"
        >
          {expanded ? <ChevronDown size={ICON.SM} /> : <ChevronRight size={ICON.SM} />}
          <HardDrive size={ICON.SM} className="text-amber-600 dark:text-amber-400" />
          <span className="truncate">{t("driveShelf.title")}</span>
          {!driveUnavailable && (
            <span className="font-normal text-amber-700 dark:text-amber-300">{t("driveShelf.personalOnly").replace("{count}", String(fileCount))}</span>
          )}
        </button>
        {loading && <Loader2 size={ICON.SM} className="animate-spin text-amber-600" />}
      </div>
      {dragOver && (
        <div className="px-2 pb-1 text-center text-[11px] font-medium text-amber-800 dark:text-amber-200">
          {t("driveShelf.dropHere")}
        </div>
      )}
      {error && <div className="px-2 pb-1 text-[11px] text-red-600 dark:text-red-400">{error}</div>}
      {driveUnavailable && (
        <div className="px-2 pb-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {t("driveShelf.connectPrompt")}
          <a href="/auth/google" className="ml-1 underline">{t("driveShelf.signInGoogle")}</a>
        </div>
      )}
      {expanded && !loading && !driveUnavailable && (
        <div className="max-h-48 overflow-y-auto border-t border-amber-200 py-1 dark:border-amber-900">
          {items.length > 0
            ? items.map((item) => renderNode(item))
            : <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{t("driveShelf.dropPrompt")}</div>}
        </div>
      )}
    </section>
  );
}
