import { useState, useRef, useEffect, useCallback } from "react";
import { X, AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { createTwoFilesPatch } from "diff";
import { DiffView } from "~/components/shared/DiffView";
import { useI18n } from "~/i18n/context";
import { getCachedFile } from "~/services/indexeddb-cache";
import { ICON } from "~/utils/icon-sizes";
import type { ConflictInfo } from "~/hooks/useSync";

interface ConflictDialogProps {
  conflicts: ConflictInfo[];
  onResolve: (fileId: string, choice: "local" | "remote", isEditDelete?: boolean) => Promise<void>;
  onClose: () => void;
}

interface DiffState {
  loading: boolean;
  diff: string | null;
  error: boolean;
  expanded: boolean;
}

export function ConflictDialog({
  conflicts,
  onResolve,
  onClose,
}: ConflictDialogProps) {
  const { t } = useI18n();
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>({});
  const [resolving, setResolving] = useState<string | null>(null);
  const [batchResolving, setBatchResolving] = useState(false);
  const [diffStates, setDiffStates] = useState<Record<string, DiffState>>({});
  const choicesRef = useRef(choices);
  useEffect(() => { choicesRef.current = choices; }, [choices]);

  const resolvedIds = useRef(new Set<string>());

  const handleResolveAll = async () => {
    const toResolve = conflicts
      .filter((c) => choicesRef.current[c.fileId])
      .map((c) => ({ fileId: c.fileId, choice: choicesRef.current[c.fileId], isEditDelete: c.isEditDelete }));
    setBatchResolving(true);
    for (const { fileId, choice, isEditDelete } of toResolve) {
      if (resolvedIds.current.has(fileId)) continue;
      setResolving(fileId);
      try {
        await onResolve(fileId, choice, isEditDelete);
        resolvedIds.current.add(fileId);
      } finally {
        setResolving(null);
      }
    }
    setBatchResolving(false);
  };

  const isTextFile = useCallback((fileName: string) => {
    return !fileName.endsWith(".encrypted");
  }, []);

  const diffStatesRef = useRef(diffStates);
  useEffect(() => { diffStatesRef.current = diffStates; }, [diffStates]);

  const handleDiffToggle = useCallback(async (fileId: string, fileName: string) => {
    const current = diffStatesRef.current[fileId];

    // Already loaded — just toggle expand/collapse
    if (current?.diff !== null && current?.diff !== undefined && !current.error) {
      setDiffStates((prev) => ({
        ...prev,
        [fileId]: { ...prev[fileId], expanded: !prev[fileId].expanded },
      }));
      return;
    }

    // Start loading
    setDiffStates((prev) => ({
      ...prev,
      [fileId]: { loading: true, diff: null, error: false, expanded: true },
    }));

    try {
      // Get local content from IndexedDB
      const cached = await getCachedFile(fileId);
      const localContent = cached?.content ?? "";

      // Get remote content via pullDirect
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pullDirect", fileIds: [fileId] }),
      });
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const remoteContent = data.files?.[0]?.content ?? "";

      const patch = createTwoFilesPatch(
        fileName,
        fileName,
        localContent,
        remoteContent,
        t("conflict.local"),
        t("conflict.remote"),
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
  }, [t]);

  const allResolved = conflicts.length === 0;
  const allChosen = conflicts.every((c) => choices[c.fileId]);

  if (allResolved) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
      <div className="mx-4 w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <AlertTriangle size={ICON.LG} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("conflict.title").replace("{count}", String(conflicts.length))}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            {conflicts.some(c => !c.isEditDelete) && t("conflict.description")}
            {conflicts.some(c => !c.isEditDelete) && conflicts.some(c => c.isEditDelete) && " "}
            {conflicts.some(c => c.isEditDelete) && t("conflict.editDeleteDescription")}
          </p>
          <p className="mb-4 text-xs text-gray-400 dark:text-gray-500 italic">
            {t("conflict.backupNote")}
          </p>

          <div className="space-y-3">
            {conflicts.map((conflict) => {
              const ds = diffStates[conflict.fileId];
              const isResolving = resolving === conflict.fileId;
              const canDiff = isTextFile(conflict.fileName);

              return (
                <div
                  key={conflict.fileId}
                  className={`rounded-lg border p-3 ${
                    isResolving
                      ? "border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-900/10"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {isResolving && <Loader2 size={ICON.SM} className="animate-spin shrink-0 text-blue-500" />}
                    <span className="truncate">{conflict.fileName}</span>
                  </div>
                  <div className="mb-2 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      {t("conflict.local")}:{" "}
                      {conflict.localModifiedTime
                        ? new Date(conflict.localModifiedTime).toLocaleString()
                        : t("conflict.unknownTime")}
                    </span>
                    <span>
                      {t("conflict.remote")}:{" "}
                      {conflict.isEditDelete
                        ? t("conflict.deletedOnRemote")
                        : conflict.remoteModifiedTime
                          ? new Date(conflict.remoteModifiedTime).toLocaleString()
                          : t("conflict.unknownTime")}
                    </span>
                  </div>

                  {/* Radio buttons + Diff button */}
                  <div className="flex items-center gap-2">
                    <label className="flex flex-1 cursor-pointer items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors select-none bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                      <input
                        type="radio"
                        name={`conflict-${conflict.fileId}`}
                        checked={choices[conflict.fileId] === "local"}
                        onChange={() => setChoices((prev) => ({ ...prev, [conflict.fileId]: "local" }))}
                        disabled={batchResolving}
                        className="accent-blue-600"
                      />
                      {t("conflict.keepLocal")}
                    </label>
                    <label className="flex flex-1 cursor-pointer items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors select-none bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                      <input
                        type="radio"
                        name={`conflict-${conflict.fileId}`}
                        checked={choices[conflict.fileId] === "remote"}
                        onChange={() => setChoices((prev) => ({ ...prev, [conflict.fileId]: "remote" }))}
                        disabled={batchResolving}
                        className="accent-green-600"
                      />
                      {conflict.isEditDelete ? t("conflict.acceptDeletion") : t("conflict.keepRemote")}
                    </label>
                    {canDiff && !conflict.isEditDelete && (
                      <button
                        onClick={() => handleDiffToggle(conflict.fileId, conflict.fileName)}
                        disabled={ds?.loading}
                        className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
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
                      {ds.diff && (
                        <div className="rounded border border-gray-200 dark:border-gray-700 overflow-x-auto max-h-64 overflow-y-auto">
                          <DiffView diff={ds.diff} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={onClose}
            disabled={batchResolving}
            className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {t("conflict.close")}
          </button>
          <button
            onClick={handleResolveAll}
            disabled={!allChosen || batchResolving}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {batchResolving ? (
              <span className="flex items-center gap-1">
                <Loader2 size={ICON.SM} className="animate-spin" />
                {t("conflict.resolving")}
              </span>
            ) : (
              t("conflict.resolveAll")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
