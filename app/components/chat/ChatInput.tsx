"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Send,
  Square,
  Paperclip,
  X,
  FileText,
  ImageIcon,
  ChevronDown,
  ChevronUp,
  Wrench,
} from "lucide-react";
import type { Attachment } from "~/types/chat";
import type { ModelType, ModelInfo, RagSetting, DriveToolMode, SlashCommand } from "~/types/settings";
import type { ChatOverrides } from "~/components/ide/ChatPanel";
import { useEditorContext } from "~/contexts/EditorContext";
import { useAutocomplete, type AutocompleteItem } from "~/hooks/useAutocomplete";
import { AutocompletePopup } from "./AutocompletePopup";

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[], overrides?: ChatOverrides) => void;
  disabled?: boolean;
  models: ModelInfo[];
  selectedModel: ModelType;
  onModelChange: (model: ModelType) => void;
  ragSettings?: Record<string, RagSetting>;
  selectedRagSetting?: string | null;
  onRagSettingChange?: (name: string | null) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  driveToolMode?: DriveToolMode;
  onDriveToolModeChange?: (mode: DriveToolMode) => void;
  enableMcp?: boolean;
  onEnableMcpChange?: (enabled: boolean) => void;
  hasMcpServers?: boolean;
  slashCommands?: SlashCommand[];
}

function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      let type: Attachment["type"] = "text";
      if (file.type.startsWith("image/")) {
        type = "image";
      } else if (file.type === "application/pdf") {
        type = "pdf";
      }
      resolve({
        name: file.name,
        type,
        mimeType: file.type,
        data: base64,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ACCEPTED_FILE_TYPES = "image/*,application/pdf";

function resolveTemplateVariables(
  text: string,
  activeFileContent: string | null,
  activeFileName: string | null,
  activeSelection: string | null
): string {
  let result = text;
  if (result.includes("{content}") && activeFileContent) {
    const prefix = activeFileName ? `From ${activeFileName}:\n` : "";
    result = result.replace(/\{content\}/g, prefix + activeFileContent);
  }
  if (result.includes("{selection}") && activeSelection) {
    result = result.replace(/\{selection\}/g, activeSelection);
  }
  return result;
}

export function ChatInput({
  onSend,
  disabled,
  models,
  selectedModel,
  onModelChange,
  ragSettings,
  selectedRagSetting,
  onRagSettingChange,
  onStop,
  isStreaming,
  driveToolMode = "all",
  onDriveToolModeChange,
  enableMcp = true,
  onEnableMcpChange,
  hasMcpServers,
  slashCommands = [],
}: ChatInputProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [pendingOverrides, setPendingOverrides] = useState<ChatOverrides | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);

  // EditorContext for autocomplete data
  const editorCtx = useEditorContext();

  // Autocomplete
  const autocomplete = useAutocomplete({
    slashCommands,
    fileList: editorCtx.fileList,
    hasActiveContent: !!editorCtx.activeFileContent,
    hasActiveSelection: !!editorCtx.activeSelection,
  });

  const handleAutocompleteSelect = useCallback(
    (item: AutocompleteItem) => {
      const result = autocomplete.selectItem(item);
      if (!result) return;

      if (item.type === "command") {
        // Replace entire content with prompt template
        setContent(result.text);
        // Store overrides from command
        if (result.command) {
          setPendingOverrides({
            model: result.command.model,
            searchSetting: result.command.searchSetting,
            driveToolMode: result.command.driveToolMode,
            enabledMcpServers: result.command.enabledMcpServers,
          });
        }
        // Focus textarea
        setTimeout(() => {
          const ta = textareaRef.current;
          if (ta) {
            ta.focus();
            ta.setSelectionRange(result.text.length, result.text.length);
          }
        }, 0);
      } else {
        // Insert at current cursor position, replacing the trigger text
        const ta = textareaRef.current;
        if (!ta) return;
        const cursorPos = ta.selectionStart;
        const before = content.slice(0, cursorPos);
        const after = content.slice(cursorPos);

        // Find the trigger position (@ or the whole content for mentions)
        let triggerStart = cursorPos;
        if (item.type === "variable" || item.type === "file") {
          // Find last @ before cursor
          const atIdx = before.lastIndexOf("@");
          if (atIdx >= 0) {
            triggerStart = atIdx;
          }
        }

        const newContent = content.slice(0, triggerStart) + result.text + " " + after;
        setContent(newContent);

        const newCursorPos = triggerStart + result.text.length + 1;
        setTimeout(() => {
          if (ta) {
            ta.focus();
            ta.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      }
    },
    [autocomplete, content]
  );

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [content]);

  // Close model dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
    }
    if (modelDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [modelDropdownOpen]);

  // Close tool dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        toolDropdownRef.current &&
        !toolDropdownRef.current.contains(e.target as Node)
      ) {
        setToolDropdownOpen(false);
      }
    }
    if (toolDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [toolDropdownOpen]);

  const handleSend = useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed && attachments.length === 0) return;
    if (disabled || isStreaming) return;

    // Resolve template variables
    const resolved = resolveTemplateVariables(
      trimmed,
      editorCtx.activeFileContent,
      editorCtx.activeFileName,
      editorCtx.activeSelection
    );

    onSend(
      resolved,
      attachments.length > 0 ? attachments : undefined,
      pendingOverrides || undefined
    );
    setContent("");
    setAttachments([]);
    setPendingOverrides(null);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [content, attachments, disabled, isStreaming, onSend, editorCtx, pendingOverrides]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Autocomplete intercepts first
      if (autocomplete.visible) {
        const consumed = autocomplete.handleKeyDown(e);
        if (consumed) {
          // Tab/Enter should select the item
          if (e.key === "Tab" || e.key === "Enter") {
            const item = autocomplete.items[autocomplete.selectedIndex];
            if (item) {
              handleAutocompleteSelect(item);
            }
          }
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, autocomplete, handleAutocompleteSelect]
  );

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      const newAttachments: Attachment[] = [];
      for (const file of Array.from(files)) {
        if (
          file.type.startsWith("image/") ||
          file.type === "application/pdf"
        ) {
          try {
            const att = await fileToAttachment(file);
            newAttachments.push(att);
          } catch {
            // skip failed files
          }
        }
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    []
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect]
  );

  const selectedModelInfo = models.find((m) => m.name === selectedModel);
  const ragSettingKeys = ragSettings ? Object.keys(ragSettings) : [];

  if (isCollapsed) {
    return (
      <div className="border-t border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-3xl justify-center">
          <button
            onClick={() => setIsCollapsed(false)}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label="Expand input"
          >
            <ChevronUp size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 bg-white px-4 pt-3 pb-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mx-auto max-w-3xl">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="relative flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
              >
                {att.type === "image" ? (
                  <ImageIcon size={12} />
                ) : (
                  <FileText size={12} />
                )}
                <span className="max-w-[120px] truncate">{att.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="ml-0.5 rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  aria-label={`Remove ${att.name}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input area with drag-and-drop */}
        <div
          className={`relative flex items-end gap-2 rounded-xl border bg-white px-3 py-2 transition-colors dark:bg-gray-800 ${
            isDragOver
              ? "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20"
              : "border-gray-300 dark:border-gray-600"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Left buttons (vertical stack) */}
          <div className="flex flex-shrink-0 flex-col items-center gap-1 self-end">
            {/* File attachment button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              aria-label="Attach file"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files)}
            />

            {/* Tool mode button */}
            {onDriveToolModeChange && (
              <div ref={toolDropdownRef} className="relative">
                <button
                  onClick={() => setToolDropdownOpen(!toolDropdownOpen)}
                  disabled={disabled}
                  className={`rounded-md p-1.5 transition-colors disabled:opacity-50 ${
                    driveToolMode !== "all" || !enableMcp
                      ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30"
                      : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  }`}
                  title="Tool settings"
                >
                  <Wrench size={18} />
                </button>
                {toolDropdownOpen && (
                  <div className="absolute bottom-full left-0 z-10 mb-1 w-52 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      Drive Tools
                    </div>
                    {(["all", "noSearch", "none"] as const).map((mode) => {
                      const labels: Record<DriveToolMode, string> = {
                        all: "All tools",
                        noSearch: "No search",
                        none: "None",
                      };
                      return (
                        <button
                          key={mode}
                          onClick={() => {
                            onDriveToolModeChange(mode);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                            driveToolMode === mode
                              ? "text-blue-700 dark:text-blue-300"
                              : "text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          <span className={`inline-block h-3 w-3 rounded-full border ${
                            driveToolMode === mode
                              ? "border-blue-500 bg-blue-500"
                              : "border-gray-400 dark:border-gray-500"
                          }`} />
                          {labels[mode]}
                        </button>
                      );
                    })}
                    {hasMcpServers && onEnableMcpChange && (
                      <>
                        <div className="mx-3 my-1 border-t border-gray-200 dark:border-gray-700" />
                        <button
                          onClick={() => onEnableMcpChange(!enableMcp)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                          <span className={`inline-flex h-3 w-3 items-center justify-center rounded border text-[8px] leading-none ${
                            enableMcp
                              ? "border-blue-500 bg-blue-500 text-white"
                              : "border-gray-400 dark:border-gray-500"
                          }`}>
                            {enableMcp ? "✓" : ""}
                          </span>
                          MCP Servers
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Autocomplete popup */}
          {autocomplete.visible && (
            <AutocompletePopup
              items={autocomplete.items}
              selectedIndex={autocomplete.selectedIndex}
              mode={autocomplete.mode}
              onSelect={handleAutocompleteSelect}
            />
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              const val = e.target.value;
              setContent(val);
              // Clear overrides if user modifies text after command selection
              if (pendingOverrides && !val.startsWith("/")) {
                // Keep overrides - user may be editing the template
              }
              autocomplete.handleInputChange(val, e.target.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type / for commands, @ for mentions..."
            disabled={disabled}
            rows={3}
            className="max-h-[200px] min-h-[80px] flex-1 resize-none bg-transparent py-1 text-sm text-gray-900 placeholder-gray-400 outline-none disabled:opacity-50 dark:text-gray-100 dark:placeholder-gray-500"
          />

          {/* Right buttons (vertical stack): collapse + send/stop */}
          <div className="flex flex-shrink-0 flex-col items-center gap-1 self-end">
            {/* Collapse button */}
            <button
              onClick={() => setIsCollapsed(true)}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              aria-label="Collapse input"
            >
              <ChevronDown size={18} />
            </button>

            {/* Send / Stop button */}
            {isStreaming ? (
              <button
                onClick={onStop}
                className="rounded-md bg-red-500 p-1.5 text-white transition-colors hover:bg-red-600"
                aria-label="Stop generating"
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={disabled || (!content.trim() && attachments.length === 0)}
                className="rounded-md bg-blue-600 p-1.5 text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            )}
          </div>

          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-blue-50/80 dark:bg-blue-900/40">
              <span className="text-sm font-medium text-blue-600 dark:text-blue-300">
                Drop files here
              </span>
            </div>
          )}
        </div>

        {/* Model selector and RAG selector row */}
        <div className="mt-2 flex items-center gap-3">
          {/* Model selector */}
          <div ref={modelDropdownRef} className="relative">
            <button
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              disabled={isStreaming}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {selectedModelInfo?.displayName || selectedModel}
              <ChevronDown size={12} />
            </button>
            {modelDropdownOpen && (
              <div className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                {models.map((model) => (
                  <button
                    key={model.name}
                    onClick={() => {
                      onModelChange(model.name);
                      setModelDropdownOpen(false);
                    }}
                    className={`flex w-full flex-col px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      model.name === selectedModel
                        ? "bg-blue-50 dark:bg-blue-900/20"
                        : ""
                    }`}
                  >
                    <span
                      className={`text-sm font-medium ${
                        model.name === selectedModel
                          ? "text-blue-700 dark:text-blue-300"
                          : "text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {model.displayName}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {model.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* RAG / Web Search selector */}
          {onRagSettingChange && (
            <select
              value={selectedRagSetting ?? ""}
              onChange={(e) =>
                onRagSettingChange(e.target.value || null)
              }
              disabled={isStreaming}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              <option value="">No RAG</option>
              <option value="__websearch__">Web Search</option>
              {ragSettingKeys.map((name) => (
                <option key={name} value={name}>
                  RAG: {name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}
