import { useEffect, useMemo, useState } from "react";
import { Download, FileArchive, Loader2 } from "lucide-react";
import { useEditorContext } from "~/contexts/EditorContext";
import { useI18n } from "~/i18n/context";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";

interface BinaryFileMetadata {
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
}

function formatBytes(size: string | undefined): string {
  if (!size) return "-";
  const bytes = Number(size);
  if (!Number.isFinite(bytes)) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  const maximumFractionDigits = index === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)} ${units[index]}`;
}

function formatDate(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export function BinaryFileInfoViewer({
  fileId,
  fileName,
  fileMimeType,
}: {
  fileId: string;
  fileName: string | null;
  fileMimeType: string | null;
}) {
  const { t } = useI18n();
  const { setActiveFileId, setActiveFileContent, setActiveFileName, setActiveSelection } = useEditorContext();
  const [metadata, setMetadata] = useState<BinaryFileMetadata | null>(null);
  const [loading, setLoading] = useState(!fileId.startsWith("new:"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveFileId(fileId);
    setActiveFileName(fileName);
    setActiveFileContent(null);
    setActiveSelection(null);
  }, [fileId, fileName, setActiveFileContent, setActiveFileId, setActiveFileName, setActiveSelection]);

  useEffect(() => {
    setMetadata(null);
    setError(null);

    if (fileId.startsWith("new:")) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      let hasCachedMetadata = false;
      try {
        const cachedRemoteMeta = await getCachedRemoteMeta();
        const cachedFileMeta = cachedRemoteMeta?.files[fileId];
        if (cachedFileMeta && !cancelled) {
          hasCachedMetadata = true;
          setMetadata({
            name: cachedFileMeta.name,
            mimeType: cachedFileMeta.mimeType,
            modifiedTime: cachedFileMeta.modifiedTime,
            size: cachedFileMeta.size,
          });
        }

        const res = await fetch(`/api/drive/files?action=metadata&fileId=${encodeURIComponent(fileId)}`);
        if (!res.ok) throw new Error("Failed to fetch metadata");
        const data = await res.json();
        if (!cancelled) setMetadata(data);
      } catch {
        if (!cancelled && !hasCachedMetadata) setError(t("mainViewer.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId, t]);

  const displayName = metadata?.name ?? fileName ?? t("mainViewer.binaryFile");
  const mimeType = metadata?.mimeType ?? fileMimeType ?? "-";
  const downloadHref = useMemo(
    () => fileId.startsWith("new:") ? null : `/api/drive/files?action=raw&download=1&fileId=${encodeURIComponent(fileId)}`,
    [fileId]
  );

  return (
    <div className="flex flex-1 items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
      <div className="w-full max-w-xl rounded-md border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-md bg-gray-100 p-2 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <FileArchive size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{displayName}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("mainViewer.binaryDescription")}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : (
          <>
            {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
            <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="text-gray-500 dark:text-gray-400">{t("mainViewer.fileName")}</dt>
              <dd className="min-w-0 break-words text-gray-900 dark:text-gray-100">{displayName}</dd>
              <dt className="text-gray-500 dark:text-gray-400">{t("mainViewer.fileSize")}</dt>
              <dd className="text-gray-900 dark:text-gray-100">{formatBytes(metadata?.size)}</dd>
              <dt className="text-gray-500 dark:text-gray-400">{t("mainViewer.modifiedTime")}</dt>
              <dd className="text-gray-900 dark:text-gray-100">{formatDate(metadata?.modifiedTime)}</dd>
              <dt className="text-gray-500 dark:text-gray-400">{t("mainViewer.mimeType")}</dt>
              <dd className="min-w-0 break-words font-mono text-xs text-gray-900 dark:text-gray-100">{mimeType}</dd>
            </dl>

            {downloadHref && (
              <a
                href={downloadHref}
                download={displayName}
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Download size={16} />
                {t("mainViewer.download")}
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
