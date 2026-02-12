"use client";
import { useState, useEffect } from "react";
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

  // On iOS Safari the layout viewport does not shrink when the virtual
  // keyboard appears, so the browser scrolls to keep the cursor visible
  // and the wysimark toolbar ends up off-screen.  Detect the keyboard
  // via visualViewport and cap the container height so toolbar + editable
  // both fit within the visible area.
  const [mobileMaxHeight, setMobileMaxHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      const isKeyboardOpen = vv.height < window.innerHeight * 0.75;
      setMobileMaxHeight(isKeyboardOpen ? vv.height * 0.5 : null);
    };
    vv.addEventListener("resize", handler);
    return () => vv.removeEventListener("resize", handler);
  }, []);

  return (
    <div
      className="wysimark-fill flex-1 min-h-0 flex flex-col overflow-hidden bg-white text-gray-900"
      style={mobileMaxHeight !== null ? { maxHeight: `${mobileMaxHeight}px`, flex: "none" } : undefined}
    >
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
