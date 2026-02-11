"use client";
import { Editable, useEditor } from "wysimark-lite";

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

  return (
    <div className="wysimark-fill flex-1 min-h-0 flex flex-col overflow-hidden bg-white text-gray-900">
      <Editable
        editor={editor}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onFileSelect={onFileSelect}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onImageChange={onImageChange as any}
      />
    </div>
  );
}
