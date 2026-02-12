import { useState, useCallback, useEffect, useRef } from "react";
import { Code, Eye, Upload, Download } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { UserSettings } from "~/types/settings";
import { MermaidPreview } from "~/components/flow/MermaidPreview";
import { useI18n } from "~/i18n/context";
import { TempDiffModal } from "./TempDiffModal";
import { addCommitBoundary } from "~/services/edit-history-local";


interface WorkflowEditorProps {
  fileId: string;
  fileName: string;
  initialContent: string;
  settings: UserSettings;
  saveToCache: (content: string) => Promise<void>;
}

export function WorkflowEditor({
  fileId,
  fileName,
  initialContent,
  settings: _settings,
  saveToCache,
}: WorkflowEditorProps) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<"visual" | "yaml">("visual");
  const [yamlContent, setYamlContent] = useState(initialContent);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mermaidChart, setMermaidChart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [tempDiffData, setTempDiffData] = useState<{
    fileName: string;
    fileId: string;
    currentContent: string;
    tempContent: string;
    tempSavedAt: string;
    currentModifiedTime: string;
    isBinary: boolean;
  } | null>(null);

  // Debounced auto-save to IndexedDB
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);

  const updateContent = useCallback((newContent: string) => {
    contentFromProps.current = false;
    setYamlContent(newContent);
  }, []);

  useEffect(() => {
    contentFromProps.current = true;
    setYamlContent(initialContent);
  }, [initialContent, fileId]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveToCache(yamlContent);
    }, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [yamlContent, saveToCache]);

  // Parse workflow YAML to mermaid on mount and when content changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { parseWorkflowYaml } = await import("~/engine/parser");
        const { workflowToMermaid } = await import(
          "~/utils/workflow-to-mermaid"
        );
        const workflow = parseWorkflowYaml(initialContent);
        const chart = workflowToMermaid(workflow);
        if (!cancelled) {
          setMermaidChart(chart);
          setParseError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setParseError(e instanceof Error ? e.message : String(e));
          setMermaidChart(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialContent, fileId]);

  // Re-parse mermaid when switching from YAML to visual
  const switchToVisual = useCallback(async () => {
    setViewMode("visual");
    setLoading(true);
    try {
      const { parseWorkflowYaml } = await import("~/engine/parser");
      const { workflowToMermaid } = await import(
        "~/utils/workflow-to-mermaid"
      );
      const workflow = parseWorkflowYaml(yamlContent);
      setMermaidChart(workflowToMermaid(workflow));
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      setMermaidChart(null);
    } finally {
      setLoading(false);
    }
  }, [yamlContent]);

  const [uploaded, setUploaded] = useState(false);

  const handleTempUpload = useCallback(async () => {
    setUploading(true);
    setUploaded(false);
    try {
      await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", fileName: fileName + ".yaml", fileId, content: yamlContent }),
      });
      await saveToCache(yamlContent);
      setUploaded(true);
      setTimeout(() => setUploaded(false), 2000);
    } finally {
      setUploading(false);
    }
  }, [yamlContent, fileName, fileId, saveToCache]);

  const handleTempDownload = useCallback(async () => {
    try {
      const res = await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", fileName: fileName + ".yaml" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.found) {
        alert(t("contextMenu.noTempFile"));
        return;
      }
      const { payload } = data.tempFile;
      setTempDiffData({
        fileName: fileName + ".yaml",
        fileId,
        currentContent: yamlContent,
        tempContent: payload.content,
        tempSavedAt: payload.savedAt,
        currentModifiedTime: "",
        isBinary: false,
      });
    } catch { /* ignore */ }
  }, [fileName, fileId, yamlContent, t]);

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    await addCommitBoundary(fileId);
    contentFromProps.current = false;
    setYamlContent(tempDiffData.tempContent);
    await saveToCache(tempDiffData.tempContent);
    setTempDiffData(null);
  }, [tempDiffData, saveToCache, fileId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {fileName}
        </span>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-md">
            <button
              onClick={switchToVisual}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                viewMode === "visual"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              <Eye size={ICON.SM} />
              Visual
            </button>
            <button
              onClick={() => setViewMode("yaml")}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                viewMode === "yaml"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              <Code size={ICON.SM} />
              YAML
            </button>
          </div>

          {uploaded && (
            <span className="text-xs text-green-600 dark:text-green-400">
              {t("contextMenu.tempUploaded")}
            </span>
          )}

          <button
            onClick={handleTempUpload}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            title={t("contextMenu.tempUpload")}
          >
            <Upload size={ICON.SM} />
            {t("contextMenu.tempUpload")}
          </button>
          <button
            onClick={handleTempDownload}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            title={t("contextMenu.tempDownload")}
          >
            <Download size={ICON.SM} />
            {t("contextMenu.tempDownload")}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {loading && viewMode === "visual" ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm text-gray-500">Loading workflow...</div>
          </div>
        ) : parseError && viewMode === "visual" ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-8">
              <p className="text-red-500 mb-2">Failed to parse workflow</p>
              <p className="text-sm text-gray-500">{parseError}</p>
              <button
                onClick={() => setViewMode("yaml")}
                className="mt-4 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Edit YAML
              </button>
            </div>
          </div>
        ) : viewMode === "visual" && mermaidChart ? (
          <div className="flex-1 overflow-auto">
            <MermaidPreview chart={mermaidChart} />
          </div>
        ) : (
          <div className="flex-1 p-4">
            <textarea
              value={yamlContent}
              onChange={(e) => updateContent(e.target.value)}
              className="w-full h-full font-mono text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 dark:text-gray-100"
              spellCheck={false}
            />
          </div>
        )}

      </div>

      {tempDiffData && (
        <TempDiffModal
          fileName={tempDiffData.fileName}
          currentContent={tempDiffData.currentContent}
          tempContent={tempDiffData.tempContent}
          tempSavedAt={tempDiffData.tempSavedAt}
          currentModifiedTime={tempDiffData.currentModifiedTime}
          isBinary={tempDiffData.isBinary}
          onAccept={handleTempDiffAccept}
          onReject={() => setTempDiffData(null)}
        />
      )}
    </div>
  );
}
