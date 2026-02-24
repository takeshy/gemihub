import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowLeft,
  Search,
  Loader2,
  FileCode,
  FileText,
  FileJson,
  File,
  Info,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import { getAllCachedFiles } from "~/services/indexeddb-cache";
import type { FileListItem } from "~/contexts/EditorContext";
import type { ApiPlan, ModelType } from "~/types/settings";

type SearchMode = "rag" | "drive" | "local";

interface SearchResult {
  id?: string;
  name: string;
  mimeType?: string;
  snippet?: string;
  location?: string;
}

export interface SearchPanelProps {
  apiPlan: ApiPlan;
  ragStoreIds: string[];
  ragTopK: number;
  fileList: FileListItem[];
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  onClose: () => void;
}

function getFileIcon(name: string) {
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    return <FileCode size={ICON.MD} className="text-orange-500 flex-shrink-0" />;
  }
  if (name.endsWith(".md")) {
    return <FileText size={ICON.MD} className="text-blue-500 flex-shrink-0" />;
  }
  if (name.endsWith(".json")) {
    return <FileJson size={ICON.MD} className="text-yellow-500 flex-shrink-0" />;
  }
  return <File size={ICON.MD} className="text-gray-400 flex-shrink-0" />;
}

export function SearchPanel({
  apiPlan,
  ragStoreIds,
  ragTopK,
  fileList,
  onSelectFile,
  onClose,
}: SearchPanelProps) {
  const { t } = useI18n();
  const hasRag = ragStoreIds.length > 0;
  const [mode, setMode] = useState<SearchMode>("local");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [ragAiText, setRagAiText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plan: ApiPlan = apiPlan === "free" ? "free" : "paid";
  const ragModelOptions = useMemo<ModelType[]>(
    () =>
      plan === "paid"
        ? ["gemini-3.1-pro-preview", "gemini-3-flash-preview"]
        : ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    [plan]
  );
  const [ragModel, setRagModel] = useState<ModelType>(ragModelOptions[0]);

  useEffect(() => {
    if (mode === "rag") {
      textareaRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [mode]);

  useEffect(() => {
    if (!ragModelOptions.includes(ragModel)) {
      setRagModel(ragModelOptions[0]);
    }
  }, [ragModelOptions, ragModel]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setSearching(true);
    setError(null);
    setResults([]);
    setRagAiText(null);
    setSearched(true);

    try {
      if (mode === "local") {
        const cachedFiles = await getAllCachedFiles();
        const terms = q.toLowerCase().split(/[\s\u3000]+/).filter(Boolean);
        const matched: SearchResult[] = [];
        for (const f of cachedFiles) {
          const nameLower = f.fileName?.toLowerCase() ?? "";
          const contentLower = f.content.toLowerCase();
          const nameMatch = terms.every((t) => nameLower.includes(t));
          const contentMatch = terms.every((t) => contentLower.includes(t));
          if (nameMatch || contentMatch) {
            let snippet: string | undefined;
            if (contentMatch) {
              const idx = contentLower.indexOf(terms[0]);
              const start = Math.max(0, idx - 40);
              const end = Math.min(f.content.length, idx + terms[0].length + 40);
              snippet = (start > 0 ? "..." : "") + f.content.slice(start, end) + (end < f.content.length ? "..." : "");
            }
            matched.push({
              id: f.fileId,
              name: f.fileName || f.fileId,
              snippet,
            });
          }
        }
        setResults(matched);
      } else {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            mode,
            ...(mode === "rag" ? { ragStoreIds, topK: ragTopK, model: ragModel } : {}),
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || "Search request failed");
        }
        const data = await res.json();

        if (data.mode === "rag") {
          if (data.aiText) setRagAiText(data.aiText);
          const ragResults: SearchResult[] = (data.results || []).map((r: { title: string; uri?: string }) => {
            const matched = fileList.find((f) => f.name === r.title || f.path === r.title);
            return {
              id: matched?.id,
              name: r.title,
              location: matched?.path || r.uri,
            };
          });
          setResults(ragResults);
        } else if (data.mode === "drive") {
          setResults(
            (data.results || []).map((r: { id: string; name: string; mimeType: string }) => ({
              id: r.id,
              name: r.name,
              mimeType: r.mimeType,
            }))
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const isServerError = msg && msg !== "Search request failed" && !/^(Failed to fetch|NetworkError|Load failed)/.test(msg);
      setError(isServerError ? msg : t("search.error"));
    } finally {
      setSearching(false);
    }
  }, [query, mode, ragStoreIds, ragTopK, ragModel, fileList, t]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      }
    },
    [handleSearch]
  );

  const handleTextareaKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSearch();
      }
    },
    [handleSearch]
  );

  useEffect(() => {
    if (!hasRag && mode === "rag") {
      setMode("drive");
      setResults([]);
      setSearched(false);
      setError(null);
    }
  }, [hasRag, mode]);

  const handleResultClick = useCallback(
    (r: SearchResult) => {
      if (r.id) {
        const mimeType = r.mimeType || (r.name.endsWith(".yaml") || r.name.endsWith(".yml") ? "text/yaml" : "text/plain");
        onSelectFile(r.id, r.name, mimeType);
      }
    },
    [onSelectFile]
  );

  const modes: Array<{ id: SearchMode; label: string; show: boolean }> = [
    { id: "local", label: t("search.localMode"), show: true },
    { id: "drive", label: t("search.driveMode"), show: true },
    { id: "rag", label: t("search.ragMode"), show: hasRag },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t("search.title")}
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title={t("search.backToFiles")}
        >
          <ArrowLeft size={ICON.MD} />
        </button>
      </div>

      {/* Mode tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        {modes.filter((m) => m.show).map((m) => (
          <button
            key={m.id}
            onClick={() => { setMode(m.id); setResults([]); setRagAiText(null); setSearched(false); setError(null); }}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
              mode === m.id
                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="px-2 py-2">
        {mode === "rag" ? (
          <>
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder={t("search.ragPlaceholder")}
              rows={3}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs outline-none focus:border-blue-500 dark:focus:border-blue-400 resize-y"
            />
            <div className="mt-1 flex items-center justify-between">
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                {typeof navigator !== "undefined" && /Macintosh|Mac OS|iPhone|iPad/.test(navigator.userAgent) ? "Cmd" : "Ctrl"}+Enter
              </p>
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 disabled:opacity-40"
              >
                {searching ? <Loader2 size={ICON.SM} className="animate-spin" /> : <Search size={ICON.SM} />}
                {t("search.title")}
              </button>
            </div>
            <div className="mt-1">
              <div className="mb-1 text-[10px] text-gray-400">{t("search.modelLabel")}</div>
              <div className="flex gap-1">
                {ragModelOptions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRagModel(m)}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      ragModel === m
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("search.placeholder")}
                className="flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs outline-none focus:border-blue-500 dark:focus:border-blue-400"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 disabled:opacity-40"
              >
                {searching ? <Loader2 size={ICON.MD} className="animate-spin" /> : <Search size={ICON.MD} />}
              </button>
            </div>
            {mode === "local" && (
              <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                <Info size="0.625rem" className="flex-shrink-0" />
                {t("search.localNote")}
              </p>
            )}
          </>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {searching && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={ICON.LG} className="animate-spin text-gray-400" />
            <span className="ml-2 text-xs text-gray-400">{t("search.searching")}</span>
          </div>
        )}

        {error && (
          <p className="py-4 text-center text-xs text-red-500">{error}</p>
        )}

        {!searching && !error && searched && results.length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">{t("search.noResults")}</p>
        )}

        {!searching && (results.length > 0 || ragAiText) && (
          <>
            {results.length > 0 && (
              <>
                <p className="mb-2 text-[10px] text-gray-400">
                  {t("search.resultCount").replace("{count}", String(results.length))}
                </p>
                <div className="space-y-0.5">
                  {results.map((r, i) => (
                    <button
                      key={r.id || `${r.name}-${i}`}
                      onClick={() => handleResultClick(r)}
                      disabled={!r.id}
                      className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-default"
                    >
                      {getFileIcon(r.name)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-700 dark:text-gray-300">{r.name}</div>
                        {r.location && (
                          <div className="mt-0.5 truncate text-[10px] text-gray-400 dark:text-gray-500">
                            {r.location}
                          </div>
                        )}
                        {r.snippet && (
                          <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500 break-words">
                            {r.snippet}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {ragAiText && (
              <div className="mt-3 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-2.5 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                {ragAiText}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
