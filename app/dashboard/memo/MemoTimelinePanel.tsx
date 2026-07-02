// Per-document memo timeline panel (ported from mdwys). Entries render
// oldest-first with the composer at the bottom; quotes jump back to the
// document via onJumpToAnchor. Wiki links/embeds in memo bodies resolve
// through GfmMarkdownPreview against the global file list.

import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { Check, ChevronsLeft, Code, CornerUpLeft, Link2Off, PenLine, Pencil, Pin, Send, Trash2, X, Loader2 } from "lucide-react";
import GfmMarkdownPreview from "~/components/ide/GfmMarkdownPreview";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import type { MemoEntry } from "~/dashboard/memo/memoTimeline";

const MarkdownEditor = lazy(() =>
  import("~/components/editor/MarkdownEditor").then((mod) => ({ default: mod.MarkdownEditor })),
);

export interface MemoDraft {
  anchor: string;
  quote: string;
  quotePrefix: string;
  quoteSuffix: string;
}

type ComposerMode = "raw" | "wysiwyg";

const COLLAPSE_LINE_LIMIT = 8;
const COLLAPSE_CHAR_LIMIT = 520;
const HOVER_PREVIEW_LIMIT = 200;

function shouldCollapse(body: string): boolean {
  const lines = body.split("\n").filter((line) => line.trim());
  return body.length > COLLAPSE_CHAR_LIMIT || lines.length > COLLAPSE_LINE_LIMIT;
}

function collapsedBody(body: string): string {
  const lines = body.split("\n");
  const byLines = lines.length > COLLAPSE_LINE_LIMIT ? lines.slice(0, COLLAPSE_LINE_LIMIT).join("\n") : body;
  const clipped = byLines.length <= COLLAPSE_CHAR_LIMIT ? byLines : byLines.slice(0, COLLAPSE_CHAR_LIMIT);
  return `${clipped.trimEnd()}\n\n...`;
}

export function memoHoverPreview(entry: MemoEntry): string {
  const text = (entry.body || entry.quote).replace(/\s+/g, " ").trim();
  return text.length > HOVER_PREVIEW_LIMIT ? `${text.slice(0, HOVER_PREVIEW_LIMIT)}…` : text;
}

function formatTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString();
}

function anchorLabel(anchor: string): string {
  if (anchor.startsWith("page=")) return `p.${anchor.slice(5)}`;
  if (anchor.startsWith("spine=")) return `§${anchor.slice(6)}`;
  return "text";
}

const iconButtonClass =
  "rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300";

function MemoEntryView({
  entry,
  unresolved,
  flashing,
  onJumpToAnchor,
  onEdit,
  onDelete,
  onTogglePin,
  onOpenFile,
}: {
  entry: MemoEntry;
  unresolved: boolean;
  flashing: boolean;
  onJumpToAnchor: (entry: MemoEntry) => void;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTogglePin: (id: string, pinned: boolean) => Promise<void>;
  onOpenFile: (fileId: string, fileName: string) => void;
}) {
  const { t } = useI18n();
  const editorCtx = useEditorContext();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(entry.body);
  const [busy, setBusy] = useState(false);
  const collapsible = shouldCollapse(entry.body);
  const bodyToRender = collapsible && !expanded ? collapsedBody(entry.body) : entry.body;

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      alert(t("memo.updateFailed"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  return (
    <article
      data-memo-entry-id={entry.id}
      className={`rounded-md border border-gray-200 p-2 transition-colors dark:border-gray-700 ${
        flashing ? "bg-amber-100 dark:bg-amber-900/40" : "bg-white dark:bg-gray-900"
      }`}
    >
      <header className="flex items-center gap-1">
        <time dateTime={entry.createdAt} className="text-[10px] text-gray-400">
          {formatTimestamp(entry.createdAt)}
        </time>
        {entry.pinned && <Pin size={11} className="shrink-0 text-amber-500" />}
        <div className="ml-auto flex items-center">
          {entry.parsed && (
            <>
              <button
                type="button"
                className={iconButtonClass}
                title={entry.pinned ? t("memo.unpin") : t("memo.pin")}
                disabled={busy}
                onClick={() => void run(() => onTogglePin(entry.id, !entry.pinned))}
              >
                <Pin size={12} />
              </button>
              <button
                type="button"
                className={iconButtonClass}
                title={t("memo.edit")}
                disabled={busy}
                onClick={() => {
                  setEditValue(entry.body);
                  setEditing(true);
                }}
              >
                <Pencil size={12} />
              </button>
            </>
          )}
          <button
            type="button"
            className={iconButtonClass}
            title={t("memo.delete")}
            disabled={busy}
            onClick={() => {
              if (confirm(t("memo.deleteConfirm"))) void run(() => onDelete(entry.id));
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </header>

      {entry.quote && (
        <button
          type="button"
          onClick={() => onJumpToAnchor(entry)}
          title={unresolved ? t("memo.broken") : t("memo.jump")}
          className={`mt-1 flex w-full items-start gap-1 rounded border-l-2 px-1.5 py-1 text-left text-xs ${
            unresolved
              ? "border-gray-300 text-gray-400 dark:border-gray-600"
              : "border-amber-400 text-gray-600 hover:bg-amber-50 dark:text-gray-300 dark:hover:bg-amber-900/20"
          }`}
        >
          {unresolved ? <Link2Off size={12} className="mt-0.5 shrink-0" /> : <CornerUpLeft size={12} className="mt-0.5 shrink-0" />}
          {entry.anchor && (
            <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {anchorLabel(entry.anchor)}
            </span>
          )}
          <span className="line-clamp-3 min-w-0 italic">{entry.quote}</span>
        </button>
      )}

      {editing ? (
        <div className="mt-1.5 space-y-1.5">
          <textarea
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            rows={Math.min(12, Math.max(3, editValue.split("\n").length + 1))}
            disabled={busy}
            className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <X size={12} />
              <span>{t("common.cancel")}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onEdit(entry.id, editValue);
                  setEditing(false);
                })
              }
              className="flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Check size={12} />
              <span>{t("common.save")}</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {bodyToRender && (
            <div className="prose prose-sm dark:prose-invert mt-1 max-w-none text-xs [&_p]:my-1">
              <GfmMarkdownPreview
                content={bodyToRender}
                fileList={editorCtx.fileList}
                onWikiLinkClick={onOpenFile}
              />
            </div>
          )}
          {collapsible && (
            <button
              type="button"
              className="mt-1 text-[11px] text-blue-500 hover:underline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t("memo.showLess") : t("memo.showMore")}
            </button>
          )}
        </>
      )}
    </article>
  );
}

export function MemoTimelinePanel({
  entries,
  loading,
  error,
  draft,
  onClearDraft,
  onPost,
  onEdit,
  onDelete,
  onTogglePin,
  unresolvedIds,
  flashEntryId,
  onJumpToAnchor,
  onCollapse,
  onClose,
}: {
  entries: MemoEntry[];
  loading: boolean;
  error: string;
  draft: MemoDraft | null;
  onClearDraft: () => void;
  onPost: (body: string, draft: MemoDraft | null) => Promise<void>;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTogglePin: (id: string, pinned: boolean) => Promise<void>;
  unresolvedIds: ReadonlySet<string>;
  flashEntryId: string | null;
  onJumpToAnchor: (entry: MemoEntry) => void;
  onCollapse: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [composerMode, setComposerMode] = useState<ComposerMode>("raw");
  const [composerValue, setComposerValue] = useState("");
  const [posting, setPosting] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Oldest first, same order as the file; the latest entry sits next to the
  // composer at the bottom.
  const lastEntryKey = entries.length ? entries[entries.length - 1].id : "";
  useEffect(() => {
    if (lastEntryKey) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lastEntryKey]);

  // Highlight click scrolls the timeline to the entry and flashes it.
  useEffect(() => {
    if (!flashEntryId) return;
    const node = listRef.current?.querySelector(`[data-memo-entry-id="${CSS.escape(flashEntryId)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [flashEntryId]);

  // A new anchored draft focuses the composer.
  useEffect(() => {
    if (draft) composerRef.current?.focus();
  }, [draft]);

  const openFile = useCallback((fileId: string, fileName: string) => {
    window.dispatchEvent(new CustomEvent("plugin-select-file", { detail: { fileId, fileName } }));
  }, []);

  const submit = useCallback(async () => {
    const body = composerValue.trim();
    if (!body && !draft) return;
    setPosting(true);
    try {
      await onPost(body, draft);
      setComposerValue("");
      onClearDraft();
    } catch (postError) {
      console.error(postError);
      alert(t("memo.postFailed"));
    } finally {
      setPosting(false);
    }
  }, [composerValue, draft, onClearDraft, onPost, t]);

  return (
    <aside className="flex w-72 max-w-[60%] shrink-0 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
      <header className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
        <strong className="text-xs text-gray-700 dark:text-gray-300">{t("memo.panelTitle")}</strong>
        <div className="ml-auto flex items-center">
          <button type="button" className={iconButtonClass} onClick={onCollapse} title={t("memo.collapse")}>
            <ChevronsLeft size={14} />
          </button>
          <button type="button" className={iconButtonClass} onClick={onClose} title={t("memo.closePanel")}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {error && <div className="p-2 text-xs text-red-500">{error}</div>}
        {!error && loading && (
          <div className="flex justify-center p-4">
            <Loader2 size={16} className="animate-spin text-gray-400" />
          </div>
        )}
        {!error && !loading && entries.length === 0 && (
          <div className="p-2 text-xs text-gray-400">{t("memo.empty")}</div>
        )}
        {entries.map((entry) => (
          <MemoEntryView
            key={`${entry.id}-${entry.index}`}
            entry={entry}
            unresolved={unresolvedIds.has(entry.id)}
            flashing={flashEntryId === entry.id}
            onJumpToAnchor={onJumpToAnchor}
            onEdit={onEdit}
            onDelete={onDelete}
            onTogglePin={onTogglePin}
            onOpenFile={openFile}
          />
        ))}
      </div>

      <footer className="shrink-0 border-t border-gray-200 p-2 dark:border-gray-800">
        {draft && (
          <div className="mb-1.5 flex items-start gap-1 rounded border-l-2 border-amber-400 bg-amber-50 px-1.5 py-1 text-xs text-gray-600 dark:bg-amber-900/20 dark:text-gray-300">
            <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {anchorLabel(draft.anchor)}
            </span>
            <span className="line-clamp-2 min-w-0 italic">{draft.quote}</span>
            <button type="button" className={`${iconButtonClass} ml-auto shrink-0`} onClick={onClearDraft} title={t("memo.discardQuote")}>
              <X size={12} />
            </button>
          </div>
        )}
        {composerMode === "wysiwyg" ? (
          <div className="max-h-48 overflow-y-auto rounded border border-gray-300 bg-white text-sm dark:border-gray-600 dark:bg-gray-800">
            <Suspense fallback={<div className="p-2 text-xs text-gray-400">{t("dashboard.loading")}</div>}>
              <MarkdownEditor value={composerValue} onChange={setComposerValue} />
            </Suspense>
          </div>
        ) : (
          <textarea
            ref={composerRef}
            value={composerValue}
            onChange={(event) => setComposerValue(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={t("memo.composerPlaceholder")}
            rows={3}
            disabled={posting}
            className="w-full resize-none rounded border border-gray-300 bg-white p-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        )}
        <div className="mt-1 flex items-center justify-between">
          <button
            type="button"
            className={iconButtonClass}
            onClick={() => setComposerMode((mode) => (mode === "raw" ? "wysiwyg" : "raw"))}
            title={composerMode === "raw" ? "WYSIWYG" : "Raw"}
          >
            {composerMode === "raw" ? <PenLine size={13} /> : <Code size={13} />}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={posting || (!composerValue.trim() && !draft)}
            className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={12} />
            <span>{t("memo.post")}</span>
          </button>
        </div>
      </footer>
    </aside>
  );
}
