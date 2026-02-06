import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface FileListItem {
  id: string;
  name: string;
  path: string;
}

interface EditorContextValue {
  activeFileContent: string | null;
  activeFileName: string | null;
  activeSelection: string | null;
  fileList: FileListItem[];
  setActiveFileContent: (content: string | null) => void;
  setActiveFileName: (name: string | null) => void;
  setActiveSelection: (selection: string | null) => void;
  setFileList: (items: FileListItem[]) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorContextProvider({ children }: { children: ReactNode }) {
  const [activeFileContent, setActiveFileContent] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [activeSelection, setActiveSelection] = useState<string | null>(null);
  const [fileList, setFileList] = useState<FileListItem[]>([]);

  return (
    <EditorContext.Provider
      value={{
        activeFileContent,
        activeFileName,
        activeSelection,
        fileList,
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
