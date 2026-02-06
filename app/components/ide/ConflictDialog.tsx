import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { ConflictInfo } from "~/hooks/useSync";

interface ConflictDialogProps {
  conflicts: ConflictInfo[];
  onResolve: (fileId: string, choice: "local" | "remote") => Promise<void>;
  onClose: () => void;
}

export function ConflictDialog({
  conflicts,
  onResolve,
  onClose,
}: ConflictDialogProps) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>({});

  const handleResolve = async (fileId: string, choice: "local" | "remote") => {
    setResolving(fileId);
    try {
      await onResolve(fileId, choice);
    } finally {
      setResolving(null);
    }
  };

  const handleResolveAll = async () => {
    for (const conflict of conflicts) {
      const choice = choices[conflict.fileId];
      if (choice) {
        setResolving(conflict.fileId);
        try {
          await onResolve(conflict.fileId, choice);
        } finally {
          setResolving(null);
        }
      }
    }
  };

  const allResolved = conflicts.length === 0;
  const allChosen = conflicts.every((c) => choices[c.fileId]);

  if (allResolved) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <AlertTriangle size={ICON.LG} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Sync Conflicts ({conflicts.length})
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
        <div className="max-h-[60vh] overflow-y-auto p-4">
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            These files were changed both locally and remotely. Choose which version to keep for each file.
          </p>

          <div className="space-y-3">
            {conflicts.map((conflict) => (
              <div
                key={conflict.fileId}
                className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
              >
                <div className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {conflict.fileName}
                </div>
                <div className="mb-2 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                  <span>Local: {conflict.localModifiedTime ? new Date(conflict.localModifiedTime).toLocaleString() : "unknown"}</span>
                  <span>Remote: {conflict.remoteModifiedTime ? new Date(conflict.remoteModifiedTime).toLocaleString() : "unknown"}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setChoices((prev) => ({ ...prev, [conflict.fileId]: "local" }));
                      handleResolve(conflict.fileId, "local");
                    }}
                    disabled={resolving === conflict.fileId}
                    className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      choices[conflict.fileId] === "local"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    } disabled:opacity-50`}
                  >
                    Keep Local
                  </button>
                  <button
                    onClick={() => {
                      setChoices((prev) => ({ ...prev, [conflict.fileId]: "remote" }));
                      handleResolve(conflict.fileId, "remote");
                    }}
                    disabled={resolving === conflict.fileId}
                    className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      choices[conflict.fileId] === "remote"
                        ? "bg-green-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    } disabled:opacity-50`}
                  >
                    Keep Remote
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Close
          </button>
          {conflicts.length > 1 && (
            <button
              onClick={handleResolveAll}
              disabled={!allChosen || !!resolving}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Resolve All
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
