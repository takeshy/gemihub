// Loads a binary document (pdf/epub/image) local-first as raw bytes:
// IndexedDB cache first, raw fetch + cache on miss. Files over the sync
// layer's large-file threshold stream directly without caching.

import { useEffect, useState } from "react";
import { readFileBinaryLocal } from "~/services/drive-local";
import { activeProjectMountParam, getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { fetchDriveFileDirect } from "~/services/drive-download";
import { isLargeFile } from "~/services/sync-client-utils";
import { base64ToBytes } from "~/utils/media-utils";

export function useBinaryFile(fileId: string | null, enabled: boolean, loadErrorLabel: string) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setBytes(null);
    setError("");
    if (!fileId || !enabled) return;
    let cancelled = false;
    const abortController = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const meta = await getCachedRemoteMeta();
        if (isLargeFile(meta?.files[fileId]?.size)) {
          // Too large for the IndexedDB cache (mirrors sync behavior) — stream
          // directly without caching.
          const res = activeProjectMountParam()
            ? await fetch(`/api/drive/files?action=raw&fileId=${encodeURIComponent(fileId)}`, { signal: abortController.signal })
            : await fetchDriveFileDirect(fileId, abortController.signal);
          if (!res.ok) throw new Error(`raw fetch failed: ${res.status}`);
          const buf = await res.arrayBuffer();
          if (!cancelled) setBytes(new Uint8Array(buf));
        } else {
          const b64 = await readFileBinaryLocal(fileId);
          if (!cancelled) setBytes(base64ToBytes(b64));
        }
      } catch (loadError) {
        console.error(loadError);
        if (!cancelled) setError(loadErrorLabel);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, enabled]);

  return { bytes, error, loading };
}
