import { useCallback, useEffect, useMemo, useState } from "react";
import { discoverOkfBundles, type OkfBundle } from "~/services/okf-loader";

const STORAGE_KEY = "gemihub_active_okf_bundle_ids";

function loadStoredIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Discovers OKF bundles under the configured root (from the cached Drive tree)
 * and manages which bundles are active for chat. The selection persists in
 * localStorage; stored ids for bundles that no longer exist are kept internally
 * (the cache may simply not be loaded yet) but filtered out of the returned
 * active list.
 */
export function useOkfBundles(okfRoot: string) {
  const [okfBundles, setOkfBundles] = useState<OkfBundle[]>([]);
  const [storedIds, setStoredIds] = useState<string[]>(loadStoredIds);

  const refreshOkfBundles = useCallback(async () => {
    const root = okfRoot.trim().replace(/^\/+|\/+$/g, "");
    if (!root) {
      setOkfBundles([]);
      return;
    }
    const discovered = await discoverOkfBundles(root).catch(() => [] as OkfBundle[]);
    setOkfBundles(discovered);
  }, [okfRoot]);

  useEffect(() => {
    void refreshOkfBundles();
  }, [refreshOkfBundles]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedIds));
    } catch {
      // ignore storage errors (private mode, quota)
    }
  }, [storedIds]);

  const toggleOkfBundle = useCallback((id: string) => {
    setStoredIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const activeOkfBundleIds = useMemo(
    () => storedIds.filter((id) => okfBundles.some((bundle) => bundle.id === id)),
    [storedIds, okfBundles]
  );

  return { okfBundles, activeOkfBundleIds, toggleOkfBundle, refreshOkfBundles };
}
