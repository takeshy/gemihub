import { useRef, type ReactNode } from "react";
// wysimark-lite is derived from portive/wysimark under the MIT License.
// See THIRD_PARTY_NOTICES.md for attribution and the full license text.
import { Editable, useEditor } from "wysimark-lite";

interface MarkdownEditorProps {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
  onFileSelect?: () => Promise<string | null>;
  onImageChange?: (file: File) => Promise<string>;
  /** Enable Obsidian-style `[[Page]]` / `![[file]]` internal links. */
  enableInternalLinks?: boolean;
  /** Render the preview shown when an internal link is selected. */
  renderInternalLinkPreview?: (target: string) => ReactNode;
  /** Render the inline content for an internal embed (`![[spec]]`). */
  renderInternalEmbed?: (spec: string) => ReactNode;
  /** Called when an internal link is activated (navigate). Receives `target#heading`. */
  onInternalLinkClick?: (target: string) => void;
}

// Minimal Slate-compatible types for the monkey-patch
type SlateEntry = [unknown, number[]];
type SlateEditor = ReturnType<typeof useEditor> & {
  children: unknown[];
  normalizeNode: (entry: SlateEntry) => void;
};

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write your content here...",
  onFileSelect,
  onImageChange,
  enableInternalLinks,
  renderInternalLinkPreview,
  renderInternalEmbed,
  onInternalLinkClick,
}: MarkdownEditorProps) {
  const editor = useEditor({
    enableInternalLinks,
    renderInternalLinkPreview,
    renderInternalEmbed,
    onInternalLinkClick,
  });
  const patchedRef = useRef(false);

  // Patch normalizeNode once to guard against empty children.
  // wysimark-lite's trailing-block plugin calls Node.child(editor, editor.children.length - 1)
  // which crashes when children is [] (e.g. parse3("-") returns []).
  // Our wrapper runs before plugin normalizers in the chain.
  if (!patchedRef.current) {
    patchedRef.current = true;
    const slateEditor = editor as unknown as SlateEditor;
    const orig = slateEditor.normalizeNode;
    slateEditor.normalizeNode = (entry: SlateEntry) => {
      const [, path] = entry;
      if (path.length === 0 && slateEditor.children.length === 0) {
        slateEditor.children = [{ type: "paragraph", children: [{ text: "" }] }];
      }
      orig(entry);
    };
  }

  return (
    <div className="wysimark-fill flex-1 min-h-0 flex flex-col overflow-hidden bg-white text-gray-900">
      <Editable
        editor={editor}
        value={value || "\n"}
        onChange={onChange}
        placeholder={placeholder}
        onFileSelect={onFileSelect}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onImageChange={onImageChange as any}
      />
    </div>
  );
}
