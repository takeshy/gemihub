// Memo List widget — browses all memo files under Dashboards/Memos/ (ported
// from mdwys's memo list modal). Filter by document name, 20 per page; each
// row shows the memo count and the beginning of the newest memo. Clicking a
// row opens the source document in the IDE main viewer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, Search } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { readFileLocal, findFileByNameLocal } from "~/services/drive-local";
import { decodeMemoPath } from "~/dashboard/memo/memoPath";
import { parseMemoFile, summarizeMemoContent } from "~/dashboard/memo/memoTimeline";
import { listMemoFilesLocal, type MemoListFile } from "~/dashboard/memo/memoStore";

const PAGE_SIZE = 20;

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

interface MemoDetail {
  count: number;
  lastText: string;
  source: string;
}

/** modifiedTime in the key drops stale cache entries when the file changes. */
function detailKey(entry: MemoListFile): string {
  return `${entry.memoPath}:${entry.modifiedTime}`;
}

/** Document path from the encoded memo file name (hash-fallback names fail). */
function decodedSource(entry: MemoListFile): string {
  const memoName = baseName(entry.memoPath).replace(/\.md$/i, "");
  return decodeMemoPath(memoName) ?? "";
}

export default function MemoListWidget() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<MemoListFile[] | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  // Per-file details (memo count, newest text, frontmatter source), loaded
  // lazily for the visible page. Undecodable (hash-fallback) file names get
  // their source read eagerly so filtering still sees them.
  const detailCache = useRef(new Map<string, MemoDetail>());
  const [details, setDetails] = useState<Record<string, MemoDetail>>({});

  const refresh = useCallback(async () => {
    const list = await listMemoFilesLocal();
    for (const entry of list) {
      if (decodedSource(entry) || detailCache.current.has(detailKey(entry))) continue;
      try {
        const content = await readFileLocal(entry.fileId);
        detailCache.current.set(detailKey(entry), {
          ...summarizeMemoContent(content),
          source: parseMemoFile(content).source,
        });
      } catch (readError) {
        console.error(readError);
      }
    }
    setDetails(Object.fromEntries(detailCache.current));
    setEntries(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Memo writes and Pulls change the underlying files — re-scan (debounced;
  // the modifiedTime-keyed cache invalidates stale summaries automatically).
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 300);
    };
    window.addEventListener("file-modified", schedule);
    window.addEventListener("files-pulled", schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("file-modified", schedule);
      window.removeEventListener("files-pulled", schedule);
    };
  }, [refresh]);

  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (entries ?? [])
      .map((entry) => ({ entry, source: details[detailKey(entry)]?.source || decodedSource(entry) }))
      .filter((item) => item.source)
      .filter((item) => !normalized || baseName(item.source).toLowerCase().includes(normalized));
  }, [entries, details, query]);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Load details for the visible page only.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const { entry } of pageItems) {
        const key = detailKey(entry);
        if (detailCache.current.has(key)) continue;
        try {
          const content = await readFileLocal(entry.fileId);
          if (cancelled) return;
          detailCache.current.set(key, {
            ...summarizeMemoContent(content),
            source: parseMemoFile(content).source,
          });
          setDetails(Object.fromEntries(detailCache.current));
        } catch (readError) {
          console.error(readError);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, currentPage]);

  const openSource = useCallback(async (source: string) => {
    const file = await findFileByNameLocal(source);
    if (!file) {
      alert(`${t("dashboard.fileNotFound")}: ${source}`);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", { detail: { fileId: file.id, fileName: file.name } }),
    );
  }, [t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 bg-white px-2 py-1.5 dark:border-gray-800 dark:bg-gray-900">
        <Search size={13} className="shrink-0 text-gray-400" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder={t("memoList.filterPlaceholder")}
          className="w-full bg-transparent text-xs text-gray-900 placeholder-gray-400 focus:outline-none dark:text-gray-100"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries === null && (
          <div className="flex justify-center p-4">
            <Loader2 size={16} className="animate-spin text-gray-400" />
          </div>
        )}
        {entries !== null && pageItems.length === 0 && (
          <div className="p-3 text-xs text-gray-400">{t("memoList.empty")}</div>
        )}
        {pageItems.map(({ entry, source }) => {
          const detail = details[detailKey(entry)];
          return (
            <button
              key={entry.memoPath}
              type="button"
              onClick={() => void openSource(source)}
              title={source}
              className="flex w-full items-start gap-2 border-b border-gray-100 px-2 py-1.5 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60"
            >
              <FileText size={14} className="mt-0.5 shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-gray-700 dark:text-gray-200">
                  {baseName(source)}
                </span>
                <span className="block truncate text-[10px] text-gray-400">{source}</span>
                {detail && (
                  <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">
                    {detail.count} {t("memo.countUnit")}
                    {detail.lastText && ` · ${detail.lastText}`}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[10px] text-gray-400">
                {new Date(entry.modifiedTime).toLocaleDateString()}
              </span>
            </button>
          );
        })}
      </div>

      {items.length > PAGE_SIZE && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-gray-200 py-1 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={currentPage <= 0}
            title={t("pdf.prevPage")}
            className="rounded p-0.5 hover:bg-gray-100 disabled:opacity-35 dark:hover:bg-gray-800"
          >
            <ChevronLeft size={14} />
          </button>
          <span>{currentPage + 1} / {pageCount}</span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            disabled={currentPage >= pageCount - 1}
            title={t("pdf.nextPage")}
            className="rounded p-0.5 hover:bg-gray-100 disabled:opacity-35 dark:hover:bg-gray-800"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
