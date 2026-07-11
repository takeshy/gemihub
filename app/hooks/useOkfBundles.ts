import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { discoverOkfBundles, type OkfBundle } from "~/services/okf-loader";
import {
  checkGemihubOkfUpdate,
  installGemihubOkfUpdate,
  type GemihubOkfUpdateInfo,
} from "~/services/gemihub-okf-update";
import { isGemihubOkfBundleName } from "~/services/gemihub-okf-manifest";

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
  const [gemihubUpdate, setGemihubUpdate] = useState<GemihubOkfUpdateInfo | null>(null);
  const [gemihubUpdateError, setGemihubUpdateError] = useState("");
  const [gemihubUpdating, setGemihubUpdating] = useState(false);
  const checkedBundleRef = useRef("");

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

  useEffect(() => {
    const bundle = okfBundles.find((candidate) =>
      activeOkfBundleIds.includes(candidate.id) && isGemihubOkfBundleName(candidate.name)
    );
    if (!bundle) {
      checkedBundleRef.current = "";
      setGemihubUpdate(null);
      setGemihubUpdateError("");
      return;
    }
    const checkKey = `${okfRoot}:${bundle.id}`;
    if (checkedBundleRef.current === checkKey) return;
    checkedBundleRef.current = checkKey;
    void checkGemihubOkfUpdate(okfRoot, bundle)
      .then(setGemihubUpdate)
      .catch((error) => {
        checkedBundleRef.current = "";
        console.warn("Failed to check GemiHub OKF update", error);
      });
  }, [activeOkfBundleIds, okfBundles, okfRoot]);

  const applyGemihubUpdate = useCallback(async () => {
    if (!gemihubUpdate || gemihubUpdating) return;
    setGemihubUpdating(true);
    setGemihubUpdateError("");
    try {
      await installGemihubOkfUpdate(gemihubUpdate);
      await refreshOkfBundles();
      setGemihubUpdate(null);
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: {
          key: "okf.update.complete",
          params: { version: gemihubUpdate.manifest.version },
          variant: "success",
        },
      }));
    } catch (error) {
      setGemihubUpdateError(error instanceof Error ? error.message : "Update failed");
    } finally {
      setGemihubUpdating(false);
    }
  }, [gemihubUpdate, gemihubUpdating, refreshOkfBundles]);

  const dismissGemihubUpdate = useCallback(() => {
    if (gemihubUpdating) return;
    setGemihubUpdate(null);
    setGemihubUpdateError("");
  }, [gemihubUpdating]);

  return {
    okfBundles,
    activeOkfBundleIds,
    toggleOkfBundle,
    refreshOkfBundles,
    gemihubUpdate,
    gemihubUpdating,
    gemihubUpdateError,
    applyGemihubUpdate,
    dismissGemihubUpdate,
  };
}
