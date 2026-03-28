import { useState, useCallback, useRef, useEffect } from "react";
import { X, Plus, Pencil, Trash2, AlertTriangle, ChevronDown, ChevronRight, Loader2, ExternalLink, ArrowUp, ArrowDown, EyeOff, Eye } from "lucide-react";
import { createTwoFilesPatch } from "diff";
import { DiffView, DiffViewToggle, type DiffViewMode } from "~/components/shared/DiffView";
import { useDraggableModal } from "~/hooks/useDraggableModal";
import { useI18n } from "~/i18n/context";
import { getCachedFile } from "~/services/indexeddb-cache";
import { isBinaryMimeType } from "~/services/sync-client-utils";
import { isEncryptedFile } from "~/services/crypto-core";
import { ICON } from "~/utils/icon-sizes";

export interface FileListItem {
  id: string;
  name: string;
  type: "new" | "modified" | "deleted" | "editDeleted" | "conflict";
}

interface SyncDiffDialogProps {
  files: FileListItem[];
  type: "push" | "pull";
  onClose: () => void;
  onSelectFile?: (fileId: string, fileName: string, mimeType: string) => void;
  onSync?: (ignoredIds?: Set<string>) => void;
  syncDisabled?: boolean;
}

interface DiffState {
  loading: boolean;
  diff: string | null;
  error: boolean;
  expanded: boolean;
}

function guessMimeType(name: string): string {
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "text/yaml";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "text/plain";
}

function canShowDiff(name: string): boolean {
  if (name.endsWith(".encrypted")) return false;
  return !isBinaryMimeType(guessMimeType(name));
}

export function SyncDiffDialog({
  files,
  type,
  onClose,
  onSelectFile,
  onSync,
  syncDisabled,
}: SyncDiffDialogProps) {
  const { t } = useI18n();
  const [diffStates, setDiffStates] = useState<Record<string, DiffState>>({});
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>("split");
  const { modalRef, modalStyle, onDragStart } = useDraggableModal();
  const diffStatesRef = useRef(diffStates);
  useEffect(() => { diffStatesRef.current = diffStates; }, [diffStates]);
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());

  const canIgnore = (fileType: FileListItem["type"]) =>
    type === "pull" && fileType === "modified";

  const toggleIgnore = useCallback((fileId: string) => {
    setIgnoredIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  // createTwoFilesPatch(old, new) — labels must match which content is old vs new
  // Push: old=Drive, new=local; Pull: old=local, new=Drive
  const oldLabel = type === "push" ? "Drive" : "Local";
  const newLabel = type === "push" ? "Local" : "Drive";

  const handleDiffToggle = useCallback(async (fileId: string, fileName: string, fileType: FileListItem["type"]) => {
    const current = diffStatesRef.current[fileId];

    if (current?.diff !== null && current?.diff !== undefined && !current.error) {
      setDiffStates((prev) => ({
        ...prev,
        [fileId]: { ...prev[fileId], expanded: !prev[fileId].expanded },
      }));
      return;
    }

    // Prevent duplicate requests while loading
    if (current?.loading) {
      setDiffStates((prev) => ({
        ...prev,
        [fileId]: { ...prev[fileId], expanded: !prev[fileId].expanded },
      }));
      return;
    }

    setDiffStates((prev) => ({
      ...prev,
      [fileId]: { loading: true, diff: null, error: false, expanded: true },
    }));

    try {
      const cached = await getCachedFile(fileId);
      const localContent = cached?.content ?? "";

      let remoteContent = "";
      if (fileType !== "new" || type === "pull") {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pullDirect", fileIds: [fileId] }),
        });
        if (res.ok) {
          const data = await res.json();
          remoteContent = data.files?.[0]?.content ?? "";
        }
      }

      // Content-based encrypted file detection
      if (isEncryptedFile(localContent) || isEncryptedFile(remoteContent)) {
        setDiffStates((prev) => ({
          ...prev,
          [fileId]: { loading: false, diff: "encrypted", error: false, expanded: true },
        }));
        return;
      }

      let oldContent: string;
      let newContent: string;
      if (fileType === "new") {
        oldContent = "";
        newContent = type === "push" ? localContent : remoteContent;
      } else if (fileType === "deleted") {
        oldContent = type === "push" ? remoteContent : localContent;
        newContent = "";
      } else {
        // modified
        oldContent = type === "push" ? remoteContent : localContent;
        newContent = type === "push" ? localContent : remoteContent;
      }

      const patch = createTwoFilesPatch(
        fileName,
        fileName,
        oldContent,
        newContent,
        oldLabel,
        newLabel,
        { context: 3 },
      );

      setDiffStates((prev) => ({
        ...prev,
        [fileId]: { loading: false, diff: patch, error: false, expanded: true },
      }));
    } catch {
      setDiffStates((prev) => ({
        ...prev,
        [fileId]: { loading: false, diff: null, error: true, expanded: true },
      }));
    }
  }, [type, oldLabel, newLabel]);

  const title = type === "push" ? t("sync.pushChanges") : t("sync.pullChanges");

  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div ref={modalRef} style={modalStyle} className="w-[min(1024px,calc(100vw-2rem))] h-[80vh] rounded-lg bg-white shadow-xl dark:bg-gray-900 flex flex-col resize overflow-auto">
        {/* Header — drag handle */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700 cursor-move select-none" onMouseDown={onDragStart}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title} ({ignoredIds.size > 0 ? `${files.length - ignoredIds.size} / ${files.length}` : files.length})
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {files.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No files</div>
          ) : (
            <div className="space-y-2">
              {files.map((f) => {
                const Icon = f.type === "new" ? Plus : f.type === "modified" ? Pencil : f.type === "editDeleted" || f.type === "conflict" ? AlertTriangle : Trash2;
                const iconColor = f.type === "new" ? "text-green-500" : f.type === "modified" ? "text-blue-500" : f.type === "editDeleted" || f.type === "conflict" ? "text-amber-500" : "text-red-500";
                const ds = diffStates[f.id];
                const diffable = canShowDiff(f.name);
                const ignored = ignoredIds.has(f.id);

                return (
                  <div
                    key={f.id}
                    className={`rounded-lg border border-gray-200 dark:border-gray-700 p-3${f.type === "conflict" ? " opacity-60" : ""}${ignored ? " opacity-50" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={14} className={`shrink-0 ${iconColor}`} />
                      <span className="truncate flex-1 text-sm text-gray-900 dark:text-gray-100" title={f.name}>
                        {f.name}
                        {f.type === "editDeleted" && (
                          <span className="ml-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            {t("conflict.deletedOnRemote")}
                          </span>
                        )}
                        {f.type === "conflict" && (
                          <span className="ml-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            {t("sync.conflictBadge")}
                          </span>
                        )}
                      </span>

                      {/* Open button */}
                      {onSelectFile && (
                        <button
                          onClick={() => {
                            onClose();
                            onSelectFile(f.id, f.name, guessMimeType(f.name));
                          }}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                        >
                          <ExternalLink size={12} />
                          {t("sync.openFile")}
                        </button>
                      )}

                      {/* Ignore toggle (pull only, not for conflict/editDeleted) */}
                      {canIgnore(f.type) && (
                        <button
                          onClick={() => toggleIgnore(f.id)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                          title={ignored ? t("sync.unignore") : t("sync.ignore")}
                        >
                          {ignored ? <Eye size={ICON.SM} /> : <EyeOff size={ICON.SM} />}
                          {ignored ? t("sync.unignore") : t("sync.ignore")}
                        </button>
                      )}

                      {/* Diff toggle (disabled for edit-delete: no remote content to compare) */}
                      {diffable && f.type !== "editDeleted" ? (
                        <button
                          onClick={() => handleDiffToggle(f.id, f.name, f.type)}
                          disabled={ds?.loading}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                        >
                          {ds?.loading ? (
                            <Loader2 size={ICON.SM} className="animate-spin" />
                          ) : ds?.expanded && ds?.diff ? (
                            <ChevronDown size={ICON.SM} />
                          ) : (
                            <ChevronRight size={ICON.SM} />
                          )}
                          {ds?.expanded && ds?.diff ? t("conflict.hideDiff") : t("conflict.diff")}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 italic">{t("sync.noDiff")}</span>
                      )}
                    </div>

                    {/* Diff panel */}
                    {ds?.expanded && (
                      <div className="mt-2">
                        {ds.loading && (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 size={ICON.LG} className="animate-spin text-gray-400" />
                          </div>
                        )}
                        {ds.error && (
                          <div className="px-3 py-2 text-xs text-red-500">
                            {t("conflict.diffError")}
                          </div>
                        )}
                        {ds.diff && ds.diff === "encrypted" ? (
                          <div className="px-3 py-2 text-xs text-gray-400 italic">
                            {t("sync.encryptedNoDiff")}
                          </div>
                        ) : ds.diff ? (
                          <div className="rounded border border-gray-200 dark:border-gray-700 overflow-x-auto max-h-64 overflow-y-auto">
                            <div className="flex justify-end px-2 py-1 border-b border-gray-200 dark:border-gray-700">
                              <DiffViewToggle viewMode={diffViewMode} onViewModeChange={setDiffViewMode} />
                            </div>
                            <DiffView diff={ds.diff} viewMode={diffViewMode} />
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <span className="text-xs text-gray-400">
            {(() => {
              if (type === "pull") {
                const conflictCount = files.filter(f => f.type === "conflict").length;
                if (conflictCount > 0) {
                  const downloadCount = files.length - conflictCount;
                  return `${t("sync.pullDirection")} (${downloadCount}) + ${t("sync.conflictBadge")} (${conflictCount})`;
                }
              }
              return type === "push" ? t("sync.pushDirection") : t("sync.pullDirection");
            })()}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {t("conflict.close")}
            </button>
            {onSync && (
              <button
                onClick={() => { onClose(); onSync(ignoredIds.size > 0 ? ignoredIds : undefined); }}
                disabled={syncDisabled}
                className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {type === "push" ? <ArrowUp size={ICON.SM} /> : <ArrowDown size={ICON.SM} />}
                {type === "push" ? t("sync.pushLabel") : t("sync.pullLabel")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
