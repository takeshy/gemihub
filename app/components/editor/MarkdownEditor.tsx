"use client";
import { Editable, useEditor } from "wysimark-lite";
import { useCallback, useMemo } from "react";
import { fromWysiwygMarkdown, toWysiwygMarkdown } from "./markdown-spacing";

interface MarkdownEditorProps {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
  onFileSelect?: () => Promise<string | null>;
  onImageChange?: (file: File) => Promise<string>;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write your content here...",
  onFileSelect,
  onImageChange,
}: MarkdownEditorProps) {
  const editor = useEditor({});
  const editorValue = useMemo(() => toWysiwygMarkdown(value), [value]);
  const handleChange = useCallback(
    (markdown: string) => {
      onChange(fromWysiwygMarkdown(markdown));
    },
    [onChange]
  );

  return (
    <div className="wysimark-fill flex-1 min-h-0 flex flex-col overflow-hidden bg-white text-gray-900">
      <Editable
        editor={editor}
        value={editorValue}
        onChange={handleChange}
        placeholder={placeholder}
        onFileSelect={onFileSelect}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onImageChange={onImageChange as any}
      />
    </div>
  );
}
