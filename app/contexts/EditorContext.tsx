import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export interface FileListItem {
  id: string;
  name: string;
  path: string;
  hasLocalChanges?: boolean;
}

export interface SelectionInfo {
  text: string;
  start: number;
  end: number;
}

interface EditorContextValue {
  activeFileId: string | null;
  activeFileContent: string | null;
  activeFileName: string | null;
  /** Read the current selection info (ref-based, no re-render) */
  getActiveSelection: () => SelectionInfo | null;
  /** True when a file is open (selection may exist). No dedicated state to avoid re-renders. */
  hasActiveSelection: boolean;
  fileList: FileListItem[];
  setActiveFileId: (id: string | null) => void;
  setActiveFileContent: (content: string | null) => void;
  setActiveFileName: (name: string | null) => void;
  /** Store selection from textarea (raw mode). For WYSIWYG, DOM selection is read lazily. */
  setActiveSelection: (selection: SelectionInfo | null) => void;
  setFileList: (items: FileListItem[]) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorContextProvider({ children }: { children: ReactNode }) {
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const activeSelectionRef = useRef<SelectionInfo | null>(null);
  const [fileList, setFileList] = useState<FileListItem[]>([]);

  const setActiveSelection = useCallback((selection: SelectionInfo | null) => {
    activeSelectionRef.current = selection;
  }, []);

  const getActiveSelection = useCallback((): SelectionInfo | null => {
    // ref has value (set by raw textarea handleSelect) → use it
    if (activeSelectionRef.current) return activeSelectionRef.current;
    // Fallback: read DOM selection (for WYSIWYG / contenteditable)
    if (typeof document !== "undefined") {
      const sel = document.getSelection();
      if (sel && sel.toString()) {
        return { text: sel.toString(), start: -1, end: -1 };
      }
    }
    return null;
  }, []);

  return (
    <EditorContext.Provider
      value={{
        activeFileId,
        activeFileContent,
        activeFileName,
        getActiveSelection,
        hasActiveSelection: !!activeFileContent,
        fileList,
        setActiveFileId,
        setActiveFileContent,
        setActiveFileName,
        setActiveSelection,
        setFileList,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error("useEditorContext must be used within EditorContextProvider");
  }
  return ctx;
}
