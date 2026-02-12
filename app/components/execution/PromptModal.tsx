import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, FileText, Folder, FolderOpen, ChevronRight, ChevronDown } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import {
  getCachedFileTree,
  type CachedTreeNode,
} from "~/services/indexeddb-cache";
import { DiffView } from "~/components/shared/DiffView";

interface PromptModalProps {
  data: Record<string, unknown>;
  onSubmit: (value: string | null) => void;
  onCancel: () => void;
}

export function PromptModal({ data, onSubmit, onCancel }: PromptModalProps) {
  const [inputValue, setInputValue] = useState(
    (data.defaultValue as string) || ""
  );
  const [selectedOptions, setSelectedOptions] = useState<string[]>(
    (data.defaults as { selected?: string[] })?.selected || []
  );
  const [treeNodes, setTreeNodes] = useState<CachedTreeNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{
    id: string;
    name: string;
    mimeType: string;
  } | null>(null);

  const promptType = data.type as string;
  const extensions = (data.extensions as string[]) || [];
  const title = (data.title as string) || "Input Required";
  const message = (data.message as string) || "";
  const options = (data.options as string[]) || [];
  const multiSelect = data.multiSelect === true;
  const button1 = (data.button1 as string) || "OK";
  const button2 = data.button2 as string | undefined;
  const inputTitle = data.inputTitle as string | undefined;
  const multiline = data.multiline === true;

  useEffect(() => {
    if (promptType !== "drive-file") return;
    (async () => {
      const cached = await getCachedFileTree();
      if (!cached) return;
      setTreeNodes(cached.items);
      // Expand all folders by default
      const folderIds = new Set<string>();
      const collectFolderIds = (nodes: CachedTreeNode[]) => {
        for (const n of nodes) {
          if (n.isFolder) {
            folderIds.add(n.id);
            if (n.children) collectFolderIds(n.children);
          }
        }
      };
      collectFolderIds(cached.items);
      setExpandedFolders(folderIds);
    })();
  }, [promptType]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const matchesExtensions = (name: string) => {
    if (extensions.length === 0) return true;
    return extensions.some((ext) => name.endsWith(`.${ext}`));
  };

  const handleSubmit = () => {
    if (promptType === "diff") {
      onSubmit("OK");
      return;
    }
    if (promptType === "drive-file") {
      if (!selectedFile) return;
      onSubmit(JSON.stringify(selectedFile));
      return;
    }
    if (promptType === "dialog") {
      onSubmit(
        JSON.stringify({
          button: button1,
          selected: selectedOptions,
          input: inputTitle ? inputValue : undefined,
        })
      );
    } else {
      onSubmit(inputValue);
    }
  };

  const handleButton2 = () => {
    if (button2) {
      onSubmit(
        JSON.stringify({
          button: button2,
          selected: selectedOptions,
          input: inputTitle ? inputValue : undefined,
        })
      );
    } else {
      onCancel();
    }
  };

  const toggleOption = (option: string) => {
    if (multiSelect) {
      setSelectedOptions((prev) =>
        prev.includes(option)
          ? prev.filter((o) => o !== option)
          : [...prev, option]
      );
    } else {
      setSelectedOptions([option]);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full mx-4 max-h-[80vh] flex flex-col ${promptType === "diff" ? "max-w-2xl" : "max-w-md"}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h3>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X size={ICON.LG} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto min-h-0">
          {message && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {message}
            </p>
          )}

          {/* Diff Review */}
          {promptType === "diff" && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {data.fileName as string}
              </div>
              <div className="max-h-96 overflow-auto border border-gray-200 dark:border-gray-700 rounded-md">
                <DiffView diff={data.diff as string} />
              </div>
            </div>
          )}

          {/* Drive File Picker */}
          {promptType === "drive-file" && (
            <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md">
              {treeNodes.length === 0 ? (
                <p className="p-3 text-sm text-gray-400">Loading files...</p>
              ) : (
                <DriveFilePickerTree
                  nodes={treeNodes}
                  depth={0}
                  expandedFolders={expandedFolders}
                  toggleFolder={toggleFolder}
                  selectedFileId={selectedFile?.id ?? null}
                  matchesExtensions={matchesExtensions}
                  onSelectFile={(node) =>
                    setSelectedFile({
                      id: node.id,
                      name: node.name,
                      mimeType: node.mimeType,
                    })
                  }
                />
              )}
            </div>
          )}

          {/* Options */}
          {options.length > 0 && (
            <div className="space-y-2">
              {options.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type={multiSelect ? "checkbox" : "radio"}
                    name="options"
                    checked={selectedOptions.includes(option)}
                    onChange={() => toggleOption(option)}
                    className="text-blue-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {option}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Password Input */}
          {promptType === "password" && (
            <div>
              <input
                type="password"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
              />
            </div>
          )}

          {/* Text Input */}
          {(promptType === "value" || inputTitle) && (
            <div>
              {inputTitle && (
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {inputTitle}
                </label>
              )}
              {multiline ? (
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 text-sm"
                  autoFocus
                />
              ) : (
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !multiline) handleSubmit();
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
          {button2 && (
            <button
              onClick={handleButton2}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
            >
              {button2}
            </button>
          )}
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={promptType === "drive-file" && !selectedFile}
          >
            {button1}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(modal, document.body);
  }
  return modal;
}

function DriveFilePickerTree({
  nodes,
  depth,
  expandedFolders,
  toggleFolder,
  selectedFileId,
  matchesExtensions,
  onSelectFile,
}: {
  nodes: CachedTreeNode[];
  depth: number;
  expandedFolders: Set<string>;
  toggleFolder: (id: string) => void;
  selectedFileId: string | null;
  matchesExtensions: (name: string) => boolean;
  onSelectFile: (node: CachedTreeNode) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.isFolder) {
          const expanded = expandedFolders.has(node.id);
          return (
            <div key={node.id}>
              <button
                onClick={() => toggleFolder(node.id)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
              >
                {expanded ? (
                  <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />
                )}
                {expanded ? (
                  <FolderOpen size={ICON.SM} className="text-yellow-500 flex-shrink-0" />
                ) : (
                  <Folder size={ICON.SM} className="text-yellow-500 flex-shrink-0" />
                )}
                <span className="truncate text-gray-700 dark:text-gray-300">
                  {node.name}
                </span>
              </button>
              {expanded && node.children && (
                <DriveFilePickerTree
                  nodes={node.children}
                  depth={depth + 1}
                  expandedFolders={expandedFolders}
                  toggleFolder={toggleFolder}
                  selectedFileId={selectedFileId}
                  matchesExtensions={matchesExtensions}
                  onSelectFile={onSelectFile}
                />
              )}
            </div>
          );
        }

        if (!matchesExtensions(node.name)) return null;

        const isSelected = node.id === selectedFileId;
        return (
          <button
            key={node.id}
            onClick={() => onSelectFile(node)}
            className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm ${
              isSelected
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
            }`}
            style={{ paddingLeft: `${depth * 16 + 28}px` }}
          >
            <FileText size={ICON.SM} className="text-gray-400 flex-shrink-0" />
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </>
  );
}
