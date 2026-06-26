// Markdown widget — references an existing Drive markdown file and renders the
// normal markdown editor (preview / wysiwyg / code) inline, so a dashboard can
// act as a 2-column editing layout. The file can be changed from the header
// picker even outside edit mode (persisted via ctx.onConfigChange).

import { useFileWithCache } from "~/hooks/useFileWithCache";
import { MarkdownFileEditor, type MdEditMode } from "~/components/ide/editors/MarkdownFileEditor";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import type { WidgetContext } from "../types";
import { MarkdownFilePicker } from "./config-editors/MarkdownFilePicker";

interface MarkdownConfig {
  /** Drive file path of the referenced markdown file. */
  path?: string;
}

// Session-scoped preview/wysiwyg/code mode for markdown widgets. Defaults to
// preview on the first view of the session, then remembers the user's last
// explicit toggle across file switches (the editor remounts per file, so this
// survives those remounts). Reset to "preview" on a full page reload.
let sessionMode: MdEditMode = "preview";

export default function MarkdownWidget({
  config,
  ctx,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const { t } = useI18n();
  const editorCtx = useEditorContext();
  const cfg = (config ?? {}) as MarkdownConfig;
  const filePath = (cfg.path ?? "").trim();
  const fileRef = editorCtx.fileList.find((f) => (f.path || f.name) === filePath);
  const fileId = fileRef?.id ?? null;

  const { content, loading, error, saveToCache } = useFileWithCache(fileId, undefined, "MarkdownWidget");

  const selectFile = (path: string) => {
    ctx?.onConfigChange?.({ path });
  };

  // No file chosen yet — prompt to pick one.
  if (!filePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-gray-400">
        <MarkdownFilePicker
          currentPath={filePath}
          onSelect={selectFile}
          placeholder={t("dashboard.markdownSelectFile")}
          buttonClassName="flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
        />
      </div>
    );
  }

  if (!fileId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-gray-400">
        <span>{t("dashboard.fileNotFound")}: {filePath}</span>
        <MarkdownFilePicker
          currentPath={filePath}
          onSelect={selectFile}
          placeholder={t("dashboard.markdownSelectFile")}
        />
      </div>
    );
  }

  if (loading && content === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        {t("dashboard.loading")}
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-gray-400">
        <span>{error || t("dashboard.fileNotFound")}</span>
        <MarkdownFilePicker
          currentPath={filePath}
          onSelect={selectFile}
          placeholder={t("dashboard.markdownSelectFile")}
        />
      </div>
    );
  }

  // Wrap in a bounded flex column so the editor's `flex-1` content area fills
  // the cell height and its preview/raw panes scroll internally (the GridCell
  // wrapper is a plain h-full block, so flex-1 would otherwise have no height).
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MarkdownFileEditor
        key={fileId}
        fileId={fileId}
        fileName={filePath}
        initialContent={content}
        saveToCache={saveToCache}
        hideToolbarActions
        initialMode={sessionMode}
        onModeChange={(m) => {
          sessionMode = m;
        }}
        headerLeft={
          <MarkdownFilePicker
            currentPath={filePath}
            onSelect={selectFile}
          />
        }
      />
    </div>
  );
}
