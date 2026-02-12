"use client";
import { useState, useEffect, useRef } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);

  // On iOS Safari the layout viewport does not shrink when the virtual
  // keyboard appears.  Detect the keyboard via visualViewport and cap the
  // container height so toolbar + editable both fit within the visible area.
  // Instead of an arbitrary ratio, measure the container's actual position to
  // compute the exact available space above the keyboard.
  const [mobileMaxHeight, setMobileMaxHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      const isKeyboardOpen = vv.height < window.innerHeight * 0.75;
      if (isKeyboardOpen && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Bottom of visible area in layout-viewport coordinates
        const visibleBottom = vv.offsetTop + vv.height;
        const available = visibleBottom - rect.top;
        setMobileMaxHeight(Math.max(available, 100));
      } else {
        setMobileMaxHeight(null);
      }
    };
    vv.addEventListener("resize", handler);
    vv.addEventListener("scroll", handler);
    return () => {
      vv.removeEventListener("resize", handler);
      vv.removeEventListener("scroll", handler);
    };
  }, []);

  return (
    <div
      ref={containerRef}
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
