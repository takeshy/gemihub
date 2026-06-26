import { useState, useEffect, useRef, useCallback } from "react";
import { useFetcher } from "react-router";
import {
  Plus,
  Loader2,
  LayoutDashboard,
  ChevronDown,
  Home,
  Edit3,
  Trash2,
  FilePlus,
} from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { UserSettings } from "~/types/settings";
import { DashboardCanvas } from "./DashboardCanvas";
import {
  resolveHomeDashboard,
  saveDashboardFile,
  createNewDashboard,
  createDefaultDashboard,
  listDashboardFiles,
  loadDashboardByPath,
  renameDashboard,
  deleteDashboard,
  dashboardPath,
  dashboardDisplayName,
  type DashboardFileEntry,
} from "./dashboardFile";
import type { DashboardData } from "./types";

interface DashboardHostProps {
  settings: UserSettings;
}

export default function DashboardHost({ settings }: DashboardHostProps) {
  const { t } = useI18n();
  const fetcher = useFetcher();

  const [data, setData] = useState<DashboardData | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [dashboards, setDashboards] = useState<DashboardFileEntry[]>([]);
  const [showDashboardMenu, setShowDashboardMenu] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [renameName, setRenameName] = useState("");
  // Optimistic local override for homeDashboard; falls back to settings.homeDashboard.
  // Updated immediately on "Set as Home" so the UI reflects the change without a reload.
  const [localHomeDashboard, setLocalHomeDashboard] = useState<string | null | undefined>(undefined);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileIdRef = useRef<string | null>(null);
  const fileNameRef = useRef<string | null>(null);
  fileIdRef.current = fileId;
  fileNameRef.current = fileName;

  // Load home dashboard + dashboard list on mount
  const loadAll = useCallback(async () => {
    const [homeResult, dashboardList] = await Promise.all([
      resolveHomeDashboard(settings.homeDashboard),
      listDashboardFiles(),
    ]);
    setDashboards(dashboardList);
    if (homeResult) {
      setData(homeResult.data);
      setFileId(homeResult.fileId);
      setFileName(homeResult.fileName);
    }
    setLoading(false);
  }, [settings.homeDashboard]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadAll();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup pending save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Rollback optimistic homeDashboard update on fetcher failure
  const prevFetcherStateRef = useRef(fetcher.state);
  useEffect(() => {
    const prevState = prevFetcherStateRef.current;
    prevFetcherStateRef.current = fetcher.state;
    if (prevState === "submitting" && fetcher.state === "idle" && fetcher.data) {
      const result = fetcher.data as { success?: boolean };
      if (!result.success) {
        setLocalHomeDashboard(undefined);
        alert(t("dashboard.setHomeFailed"));
      }
    }
  }, [fetcher.state, fetcher.data, t]);

  // Debounced save — reads fileId/fileName via ref to avoid stale closure
  const handleCommit = useCallback((newData: DashboardData) => {
    setData(newData);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const id = await saveDashboardFile(newData, fileIdRef.current, fileNameRef.current ?? undefined);
      setFileId(id);
      fileIdRef.current = id;
      saveTimerRef.current = null;
    }, 500);
  }, []);

  // --- Dashboard lifecycle ---

  const refreshDashboardList = useCallback(async () => {
    const list = await listDashboardFiles();
    setDashboards(list);
  }, []);

  const handleCreateDashboard = useCallback(async () => {
    const name = newDashboardName.trim();
    if (!name) return;
    const path = dashboardPath(name);
    if (dashboards.some((d) => d.fileName === path)) {
      alert(t("dashboard.dashboardNameExists"));
      return;
    }
    const id = await createNewDashboard(name);
    setFileId(id);
    fileIdRef.current = id;
    setFileName(path);
    fileNameRef.current = path;
    setData({ version: 1, grid: { cols: 12, rowHeight: 80, gap: 8 }, widgets: [] });
    setLoading(false);
    setEditMode(true);
    setShowCreateDialog(false);
    setNewDashboardName("");
    await refreshDashboardList();
  }, [newDashboardName, dashboards, t, refreshDashboardList]);

  const handleCreateDefaultFromEmpty = useCallback(async () => {
    // Create the starter dashboard under dashboards/ (like workflows live under
    // workflows/). New dashboards never go to the legacy root home.dashboard.
    const defaultData = createDefaultDashboard();
    const path = dashboardPath("home");
    setData(defaultData);
    setLoading(false);
    const id = await saveDashboardFile(defaultData, null, path);
    setFileId(id);
    fileIdRef.current = id;
    setFileName(path);
    fileNameRef.current = path;
    await refreshDashboardList();
  }, [refreshDashboardList]);

  const handleSwitchDashboard = useCallback(async (entry: DashboardFileEntry) => {
    setShowDashboardMenu(false);
    setLoading(true);
    // Flush any pending save before switching
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (data && fileIdRef.current) {
        await saveDashboardFile(data, fileIdRef.current, fileNameRef.current ?? undefined);
      }
    }
    const result = await loadDashboardByPath(entry.fileName);
    if (result) {
      setData(result.data);
      setFileId(result.fileId);
      fileIdRef.current = result.fileId;
      setFileName(entry.fileName);
      fileNameRef.current = entry.fileName;
      setEditMode(false);
    }
    setLoading(false);
  }, [data]);

  const handleRenameDashboard = useCallback(async () => {
    if (!fileId || !fileName) return;
    const name = renameName.trim();
    if (!name) return;
    const newPath = dashboardPath(name);
    // Collision check: skip the current file itself
    if (dashboards.some((d) => d.fileId !== fileId && d.fileName === newPath)) {
      alert(t("dashboard.dashboardNameExists"));
      return;
    }
    const newName = await renameDashboard(fileId, fileName, name);
    setFileName(newName);
    fileNameRef.current = newName;
    setShowRenameDialog(false);
    setRenameName("");
    await refreshDashboardList();
  }, [fileId, fileName, renameName, dashboards, t, refreshDashboardList]);

  const effectiveHomeDashboard =
    localHomeDashboard !== undefined ? localHomeDashboard : settings.homeDashboard;

  const handleDeleteDashboard = useCallback(async () => {
    if (!fileId) return;
    if (!confirm(t("dashboard.deleteDashboardConfirm"))) return;
    await deleteDashboard(fileId);
    setEditMode(false);
    // Switch to next available dashboard or empty state
    await refreshDashboardList();
    const homeResult = await resolveHomeDashboard(effectiveHomeDashboard);
    if (homeResult) {
      setData(homeResult.data);
      setFileId(homeResult.fileId);
      setFileName(homeResult.fileName);
    } else {
      setData(null);
      setFileId(null);
      setFileName(null);
    }
  }, [fileId, t, effectiveHomeDashboard, refreshDashboardList]);

  const handleSetHome = useCallback(() => {
    if (!fileName) return;
    // Optimistic update so the home indicator reflects immediately
    setLocalHomeDashboard(fileName);
    fetcher.submit(
      { _action: "saveHomeDashboard", homeDashboard: fileName },
      { method: "post", action: "/settings" },
    );
  }, [fileName, fetcher]);

  const isHomeDashboard = fileName === effectiveHomeDashboard ||
    (!effectiveHomeDashboard && fileName === "home.dashboard");

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  // No dashboards at all — show "create dashboard" CTA
  if (!data && dashboards.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 gap-4">
        <LayoutDashboard size={48} className="text-gray-300 dark:text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
          {t("dashboard.empty")}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <FilePlus size={16} />
            {t("dashboard.newDashboard")}
          </button>
          <button
            onClick={handleCreateDefaultFromEmpty}
            className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Plus size={16} />
            {t("dashboard.create")}
          </button>
        </div>
        {showCreateDialog && (
          <CreateDashboardDialog
            value={newDashboardName}
            onChange={setNewDashboardName}
            onCreate={handleCreateDashboard}
            onClose={() => setShowCreateDialog(false)}
          />
        )}
      </div>
    );
  }

  // Loading has finished (handled above) but no dashboard could be resolved —
  // e.g. dashboards exist in the listing but their content failed to load
  // (offline, deleted, or unparseable). Offer a retry / create instead of
  // spinning forever.
  if (!data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 gap-4">
        <LayoutDashboard size={48} className="text-gray-300 dark:text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
          {t("dashboard.loadFailed")}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setLoading(true);
              void loadAll();
            }}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t("mainViewer.retry")}
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <FilePlus size={16} />
            {t("dashboard.newDashboard")}
          </button>
        </div>
        {dashboards.length > 0 && (
          <ul className="w-56 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 max-h-64 overflow-auto">
            {dashboards.map((d) => (
              <li key={d.fileId}>
                <button
                  onClick={() => handleSwitchDashboard(d)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <span className="truncate">{d.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {showCreateDialog && (
          <CreateDashboardDialog
            value={newDashboardName}
            onChange={setNewDashboardName}
            onCreate={handleCreateDashboard}
            onClose={() => setShowCreateDialog(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <DashboardCanvas
        data={data}
        onChange={handleCommit}
        editMode={editMode}
        onEditModeChange={setEditMode}
        dashboardFileId={fileId ?? undefined}
        toolbarLeft={
          <>
            <LayoutDashboard size={14} className="text-gray-400" />
            <button
              onClick={() =>
                setShowDashboardMenu((v) => {
                  const next = !v;
                  // Refresh on open: rename/move from the file tree updates
                  // CachedRemoteMeta but fires no event, so re-read the listing
                  // here to drop dashboards that were moved/renamed/deleted.
                  if (next) void refreshDashboardList();
                  return next;
                })
              }
              className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              {fileName ? dashboardDisplayName(fileName) : t("dashboard.title")}
              <ChevronDown size={12} />
            </button>
            {isHomeDashboard && (
              <span className="flex items-center gap-0.5 text-xs text-blue-500">
                <Home size={10} />
              </span>
            )}
          </>
        }
        toolbarEditActions={
          <>
            <button
              onClick={() => {
                setRenameName(dashboardDisplayName(fileName ?? ""));
                setShowRenameDialog(true);
              }}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <Edit3 size={12} />
            </button>
            <button
              onClick={handleDeleteDashboard}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/30"
            >
              <Trash2 size={12} />
            </button>
            {!isHomeDashboard && (
              <button
                onClick={handleSetHome}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                title={t("dashboard.setHome")}
              >
                <Home size={12} />
              </button>
            )}
          </>
        }
      />

      {/* Dashboard switcher dropdown */}
      {showDashboardMenu && (
        <DashboardSwitcherMenu
          dashboards={dashboards}
          currentFileName={fileName}
          homeFileName={effectiveHomeDashboard ?? null}
          onSelect={handleSwitchDashboard}
          onClose={() => setShowDashboardMenu(false)}
          onCreate={() => {
            setShowDashboardMenu(false);
            setShowCreateDialog(true);
          }}
        />
      )}

      {/* Create dashboard dialog */}
      {showCreateDialog && (
        <CreateDashboardDialog
          value={newDashboardName}
          onChange={setNewDashboardName}
          onCreate={handleCreateDashboard}
          onClose={() => setShowCreateDialog(false)}
        />
      )}

      {/* Rename dialog */}
      {showRenameDialog && (
        <CreateDashboardDialog
          value={renameName}
          onChange={setRenameName}
          onCreate={handleRenameDashboard}
          onClose={() => setShowRenameDialog(false)}
          isRename
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CreateDashboardDialog({
  value,
  onChange,
  onCreate,
  onClose,
  isRename = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onCreate: () => void;
  onClose: () => void;
  isRename?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg bg-white dark:bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {isRename ? t("dashboard.rename") : t("dashboard.newDashboard")}
          </h3>
        </div>
        <div className="p-4">
          <input
            type="text"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreate();
              if (e.key === "Escape") onClose();
            }}
            placeholder={t("dashboard.dashboardName")}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
          >
            {t("dashboard.cancel")}
          </button>
          <button
            onClick={onCreate}
            disabled={!value.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isRename ? t("dashboard.rename") : t("dashboard.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardSwitcherMenu({
  dashboards,
  currentFileName,
  homeFileName,
  onSelect,
  onClose,
  onCreate,
}: {
  dashboards: DashboardFileEntry[];
  currentFileName: string | null;
  homeFileName: string | null;
  onSelect: (entry: DashboardFileEntry) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-3 top-12 z-40 w-56 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg"
    >
      <ul className="py-1 max-h-64 overflow-auto">
        {dashboards.map((d) => (
          <li key={d.fileId}>
            <button
              onClick={() => onSelect(d)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                d.fileName === currentFileName
                  ? "text-blue-600 dark:text-blue-400 font-medium"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {d.fileName === homeFileName && (
                <Home size={12} className="text-blue-500 shrink-0" />
              )}
              <span className="truncate">{d.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-200 dark:border-gray-700 py-1">
        <button
          onClick={onCreate}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <FilePlus size={14} />
          {t("dashboard.newDashboard")}
        </button>
      </div>
    </div>
  );
}
