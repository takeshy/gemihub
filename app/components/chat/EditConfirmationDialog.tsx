import { useMemo, useState } from "react";
import { createTwoFilesPatch } from "diff";
import type { DriveEditProposal } from "~/engine/local-executor";
import { DiffView, DiffViewToggle, type DiffViewMode } from "~/components/shared/DiffView";

interface EditConfirmationDialogProps {
  proposal: DriveEditProposal;
  language: "en" | "ja";
  onConfirm: () => void;
  onCancel: () => void;
}

export function EditConfirmationDialog({ proposal, language, onConfirm, onCancel }: EditConfirmationDialogProps) {
  const [viewMode, setViewMode] = useState<DiffViewMode>("split");
  const diff = useMemo(() => createTwoFilesPatch(
    proposal.fileName,
    proposal.fileName,
    proposal.oldContent,
    proposal.newContent,
    "Before",
    "After",
  ), [proposal]);
  const ja = language === "ja";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-hidden bg-black/50 px-2 pt-2 sm:items-center sm:p-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-edit-confirm-title"
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900"
        style={{ maxHeight: "calc(100dvh - env(safe-area-inset-bottom, 0px) - 1rem)" }}
      >
        <div className="shrink-0 border-b border-gray-200 px-4 py-3 sm:px-5 sm:py-4 dark:border-gray-700">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="chat-edit-confirm-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {ja ? "ファイルの変更を確認" : "Review file changes"}
              </h2>
              <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={proposal.fileName}>{proposal.fileName}</p>
            </div>
            <DiffViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-3 dark:bg-gray-950">
          <DiffView diff={diff} viewMode={viewMode} />
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3 sm:px-5 dark:border-gray-700">
          <button type="button" onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
            {ja ? "キャンセル" : "Cancel"}
          </button>
          <button type="button" onClick={onConfirm} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            {ja ? "変更を適用" : "Apply changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
