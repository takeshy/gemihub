import { useState, useCallback, useMemo } from "react";
import type { SlashCommand } from "~/types/settings";
import type { FileListItem } from "~/contexts/EditorContext";

export type AutocompleteMode = "command" | "mention" | null;

export interface AutocompleteItem {
  type: "command" | "variable" | "file";
  label: string;
  description: string;
  value: string; // inserted into text
  command?: SlashCommand;
}

interface UseAutocompleteOptions {
  slashCommands: SlashCommand[];
  fileList: FileListItem[];
  hasActiveContent: boolean;
  hasActiveSelection: boolean;
}

interface UseAutocompleteReturn {
  items: AutocompleteItem[];
  selectedIndex: number;
  visible: boolean;
  mode: AutocompleteMode;
  query: string;
  handleInputChange: (value: string, cursorPos: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => boolean; // returns true if consumed
  selectItem: (item: AutocompleteItem) => SelectResult | null;
  close: () => void;
}

export interface SelectResult {
  text: string;
  cursorOffset: number;
  command?: SlashCommand;
}

export function useAutocomplete({
  slashCommands,
  fileList,
  hasActiveContent,
  hasActiveSelection,
}: UseAutocompleteOptions): UseAutocompleteReturn {
  const [mode, setMode] = useState<AutocompleteMode>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState(0);

  // Build mention items
  const mentionItems = useMemo<AutocompleteItem[]>(() => {
    const items: AutocompleteItem[] = [];
    if (hasActiveContent) {
      items.push({
        type: "variable",
        label: "{content}",
        description: "Current file content",
        value: "{content}",
      });
    }
    if (hasActiveSelection) {
      items.push({
        type: "variable",
        label: "{selection}",
        description: "Selected text",
        value: "{selection}",
      });
    }
    for (const file of fileList) {
      items.push({
        type: "file",
        label: file.name,
        description: file.path,
        value: `@${file.name}`,
      });
    }
    return items;
  }, [fileList, hasActiveContent, hasActiveSelection]);

  // Build command items
  const commandItems = useMemo<AutocompleteItem[]>(
    () =>
      slashCommands.map((cmd) => ({
        type: "command" as const,
        label: cmd.name,
        description: cmd.description,
        value: `/${cmd.name}`,
        command: cmd,
      })),
    [slashCommands]
  );

  // Filter items based on query
  const items = useMemo<AutocompleteItem[]>(() => {
    if (!mode) return [];
    const source = mode === "command" ? commandItems : mentionItems;
    if (!query) return source;
    const q = query.toLowerCase();
    return source.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
  }, [mode, query, commandItems, mentionItems]);

  const visible = mode !== null && items.length > 0;

  const close = useCallback(() => {
    setMode(null);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const handleInputChange = useCallback(
    (value: string, cursorPos: number) => {
      // Check for / at start of line (command mode)
      if (value.startsWith("/")) {
        const q = value.slice(1, cursorPos);
        // Only activate if no space in query (single-word command name)
        if (!q.includes(" ")) {
          setMode("command");
          setQuery(q);
          setTriggerPos(0);
          setSelectedIndex(0);
          return;
        }
      }

      // Check for @ trigger
      const beforeCursor = value.slice(0, cursorPos);
      const atIdx = beforeCursor.lastIndexOf("@");
      if (atIdx >= 0) {
        const charBefore = atIdx > 0 ? value[atIdx - 1] : " ";
        // @ must be at start or preceded by space/newline
        if (charBefore === " " || charBefore === "\n" || atIdx === 0) {
          const q = beforeCursor.slice(atIdx + 1);
          if (!q.includes(" ") && !q.includes("\n")) {
            setMode("mention");
            setQuery(q);
            setTriggerPos(atIdx);
            setSelectedIndex(0);
            return;
          }
        }
      }

      // No trigger found
      if (mode) close();
    },
    [mode, close]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!visible) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
          return true;
        case "Tab":
        case "Enter":
          if (items[selectedIndex]) {
            e.preventDefault();
            return true; // caller should call selectItem
          }
          return false;
        case "Escape":
          e.preventDefault();
          close();
          return true;
        default:
          return false;
      }
    },
    [visible, items, selectedIndex, close]
  );

  const selectItem = useCallback(
    (item: AutocompleteItem): SelectResult | null => {
      close();
      if (item.type === "command") {
        return {
          text: item.command?.promptTemplate || "",
          cursorOffset: item.command?.promptTemplate?.length || 0,
          command: item.command,
        };
      }
      // mention or variable: return the text to insert
      return {
        text: item.value,
        cursorOffset: item.value.length,
      };
    },
    [close]
  );

  return {
    items,
    selectedIndex,
    visible,
    mode,
    query,
    handleInputChange,
    handleKeyDown,
    selectItem,
    close,
  };
}
