import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Globe, Clock, Plus, Trash2, Loader2, CheckCircle, AlertCircle, CreditCard, Users, ChevronDown, ChevronRight, Database, RefreshCw, Upload, Sparkles, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { SectionCard } from "~/components/settings/shared";
import type { UserSettings, HubworkSchedule, HubworkAccountType, HubworkDataSource, HubworkSpreadsheet } from "~/types/settings";

interface AccountTypeEntry {
  config: HubworkAccountType;
  expanded: boolean;
}

interface DataSourceEntry {
  key: string;
  source: HubworkDataSource;
}

/** Per-spreadsheet fetched metadata */
interface SheetMeta {
  sheets: string[];
  headers: Record<string, string[]>;
}

function accountsToEntries(accounts?: Record<string, HubworkAccountType>): AccountTypeEntry[] {
  if (!accounts) return [];
  return Object.values(accounts).map((config) => ({
    config,
    expanded: false,
  }));
}

/** Use identity.sheet as the key (type name) for each account type */
function entriesToAccounts(entries: AccountTypeEntry[]): Record<string, HubworkAccountType> {
  const result: Record<string, HubworkAccountType> = {};
  for (const entry of entries) {
    const key = entry.config.identity.sheet.trim();
    if (!key) continue;
    result[key] = entry.config;
  }
  return result;
}

function dataToEntries(data?: Record<string, HubworkDataSource>): DataSourceEntry[] {
  if (!data) return [];
  return Object.entries(data).map(([key, source]) => ({ key, source }));
}

function entriesToData(entries: DataSourceEntry[]): Record<string, HubworkDataSource> | undefined {
  const result: Record<string, HubworkDataSource> = {};
  for (const entry of entries) {
    if (!entry.key.trim()) continue;
    result[entry.key.trim()] = entry.source;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Migrate legacy single spreadsheetId to spreadsheets array */
function initSpreadsheets(hubwork?: UserSettings["hubwork"]): HubworkSpreadsheet[] {
  if (hubwork?.spreadsheets && hubwork.spreadsheets.length > 0) return hubwork.spreadsheets;
  if (hubwork?.spreadsheetId) return [{ id: hubwork.spreadsheetId }];
  return [];
}

/** Get a display label for a spreadsheet entry */
function spreadsheetLabel(ss: HubworkSpreadsheet): string {
  if (ss.label) return ss.label;
  return ss.id.length > 16 ? `${ss.id.slice(0, 16)}…` : ss.id;
}

/** Extract spreadsheet ID from URL or raw ID */
function parseSpreadsheetId(raw: string): string {
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : raw;
}

export function HubworkTab({ settings, hasHubworkScopes, rootFolderId, isCallback }: { settings: UserSettings; hasHubworkScopes: boolean; rootFolderId: string; isCallback?: boolean }) {
  const { t } = useI18n();
  const hubwork = settings.hubwork;
  const domainFetcher = useFetcher();
  const scheduleFetcher = useFetcher();
  const stripeFetcher = useFetcher();
  const accountsFetcher = useFetcher();
  const [domain, setDomain] = useState(hubwork?.customDomain || "");
  const [schedules, setSchedules] = useState<HubworkSchedule[]>(hubwork?.schedules || []);
  const [spreadsheets, setSpreadsheets] = useState<HubworkSpreadsheet[]>(initSpreadsheets(hubwork));
  const [sheetMeta, setSheetMeta] = useState<Record<string, SheetMeta>>({});
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});
  const [accountTypes, setAccountTypes] = useState<AccountTypeEntry[]>(
    accountsToEntries(hubwork?.accounts)
  );

  const [slug, setSlug] = useState("");
  const [slugError, setSlugError] = useState("");
  const [skillUpdating, setSkillUpdating] = useState(false);
  const [skillUpdateResult, setSkillUpdateResult] = useState<"success" | "error" | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [skillMissing, setSkillMissing] = useState(false);
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);

  // Check whether the webpage-builder skill exists locally
  useEffect(() => {
    const isPro = hubwork?.plan === "pro" || hubwork?.plan === "granted";
    if (!isPro) return;
    (async () => {
      try {
        const { getCachedRemoteMeta } = await import("~/services/indexeddb-cache");
        const cachedMeta = await getCachedRemoteMeta();
        const exists = cachedMeta && Object.values(cachedMeta.files).some(
          (f) => f.name?.startsWith("skills/webpage-builder/")
        );
        setSkillMissing(!exists);
      } catch { /* ignore */ }
    })();
  }, [hubwork?.plan]);

  // Provision skill files only on Stripe callback redirect
  const provisionedRef = useRef(false);
  useEffect(() => {
    if (provisionedRef.current) return;
    if (!isCallback) return;
    const isPro = hubwork?.plan === "pro" || hubwork?.plan === "granted";
    if (!isPro) return;
    provisionedRef.current = true;
    (async () => {
      setProvisioning(true);
      try {
        const { setCachedFile, getCachedRemoteMeta, setCachedRemoteMeta, getLocalSyncMeta, setLocalSyncMeta, setCachedFileTree } = await import("~/services/indexeddb-cache");
        const { buildTreeFromMeta } = await import("~/utils/file-tree-operations");

        // Activate the skill in localStorage so it's active when IDE loads
        try {
          const stored = localStorage.getItem("gemihub:activeSkills");
          const activeSkills: string[] = stored ? JSON.parse(stored) : [];
          if (!activeSkills.includes("webpage-builder")) {
            activeSkills.push("webpage-builder");
            localStorage.setItem("gemihub:activeSkills", JSON.stringify(activeSkills));
          }
        } catch { /* ignore */ }

        const res = await fetch("/api/settings/hubwork-provision", { method: "POST" });
        const data = await res.json();
        if (data.isFirstProvision) {
          setShowWelcomeDialog(true);
        }
        const files = data.files as Array<{ id: string; name: string; path: string; mimeType: string; content: string; md5Checksum?: string; modifiedTime?: string }> | undefined;
        if (!files || files.length === 0) return;
        // Register in IndexedDB
        const now = new Date().toISOString();
        for (const f of files) {
          await setCachedFile({
            fileId: f.id,
            content: f.content,
            md5Checksum: f.md5Checksum || "",
            modifiedTime: f.modifiedTime || now,
            cachedAt: Date.now(),
            fileName: f.path,
          });
        }
        const meta = await getCachedRemoteMeta() ?? { id: "current", rootFolderId: "", lastUpdatedAt: now, files: {}, cachedAt: Date.now() };
        for (const f of files) {
          meta.files[f.id] = { name: f.path, mimeType: f.mimeType, md5Checksum: f.md5Checksum || "", modifiedTime: f.modifiedTime || now };
        }
        await setCachedRemoteMeta(meta);
        const localMeta = await getLocalSyncMeta() ?? { id: "current" as const, lastUpdatedAt: now, files: {} };
        for (const f of files) {
          localMeta.files[f.id] = { md5Checksum: f.md5Checksum || "", modifiedTime: f.modifiedTime || now, name: f.path };
        }
        await setLocalSyncMeta(localMeta);
        // Rebuild file tree cache so skills are discoverable immediately on IDE load
        const items = buildTreeFromMeta(meta);
        await setCachedFileTree({ id: "current", rootFolderId: meta.rootFolderId, items, cachedAt: Date.now() });
        setSkillMissing(false);
      } catch { /* best-effort */ }
      finally {
        setProvisioning(false);
      }
    })();
  }, [isCallback, hubwork?.plan]);

  const fetchSheetMeta = useCallback(async (ssId: string) => {
    if (!ssId.trim()) return;
    setFetchingIds((prev) => new Set(prev).add(ssId));
    setFetchErrors((prev) => { const n = { ...prev }; delete n[ssId]; return n; });
    try {
      const res = await fetch(`/api/settings/hubwork-sheets?spreadsheetId=${encodeURIComponent(ssId)}`);
      const data = await res.json();
      if (data.error) {
        setFetchErrors((prev) => ({ ...prev, [ssId]: data.error }));
        setSheetMeta((prev) => { const n = { ...prev }; delete n[ssId]; return n; });
      } else {
        setSheetMeta((prev) => ({ ...prev, [ssId]: { sheets: data.sheets || [], headers: data.headers || {} } }));
        // Use spreadsheet title as label
        if (data.title) {
          setSpreadsheets((prev) => prev.map((s) => s.id === ssId ? { ...s, label: data.title } : s));
        }
      }
    } catch {
      setFetchErrors((prev) => ({ ...prev, [ssId]: "Failed to fetch" }));
      setSheetMeta((prev) => { const n = { ...prev }; delete n[ssId]; return n; });
    } finally {
      setFetchingIds((prev) => { const n = new Set(prev); n.delete(ssId); return n; });
    }
  }, []);

  // --- Spreadsheets save (per-row) ---
  const [savingSSIds, setSavingSSIds] = useState<Set<string>>(new Set());
  const [savedSSIds, setSavedSSIds] = useState<Set<string>>(new Set());

  const saveSpreadsheet = useCallback(async (ssId: string) => {
    if (!ssId.trim()) return;
    setSavingSSIds((prev) => new Set(prev).add(ssId));
    try {
      const ss = spreadsheets.filter((s) => s.id.trim());
      const ac = entriesToAccounts(accountTypes);
      const formData = new FormData();
      formData.set("_action", "hubwork-accounts");
      formData.set("spreadsheets", JSON.stringify(ss));
      formData.set("accounts", JSON.stringify(ac));
      const res = await fetch("/settings", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      await fetchSheetMeta(ssId);
      setSavedSSIds((prev) => new Set(prev).add(ssId));
    } catch {
      // fetchSheetMeta already sets fetchErrors
    } finally {
      setSavingSSIds((prev) => { const n = new Set(prev); n.delete(ssId); return n; });
    }
  }, [spreadsheets, accountTypes, fetchSheetMeta]);

  // --- Account types save ---
  const lastSavedAcJson = useRef(JSON.stringify(entriesToAccounts(accountTypes)));
  const hasUnsavedAccounts = JSON.stringify(entriesToAccounts(accountTypes)) !== lastSavedAcJson.current;

  const saveAccounts = useCallback(() => {
    const ss = spreadsheets.filter((s) => s.id.trim());
    const ac = entriesToAccounts(accountTypes);
    lastSavedAcJson.current = JSON.stringify(ac);
    const formData = new FormData();
    formData.set("_action", "hubwork-accounts");
    formData.set("spreadsheets", JSON.stringify(ss));
    formData.set("accounts", JSON.stringify(ac));
    accountsFetcher.submit(formData, { method: "post", action: "/settings" });
  }, [spreadsheets, accountTypes, accountsFetcher]);

  // Auto-fetch sheet metadata for saved spreadsheets on mount
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (autoFetchedRef.current) return;
    autoFetchedRef.current = true;
    for (const ss of spreadsheets) {
      if (ss.id.trim() && !sheetMeta[ss.id]) {
        fetchSheetMeta(ss.id).then(() => {
          setSavedSSIds((prev) => new Set(prev).add(ss.id));
        });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = hubwork?.plan;
  const isEnabled = !!plan;
  const isPro = plan === "pro" || plan === "granted";
  const isPaidApiKey = settings.apiPlan === "paid";

  // Compute whether all spreadsheets used by account types have been fetched
  const usedSpreadsheetIds = new Set<string>();
  for (const entry of accountTypes) {
    const idId = entry.config.identity.spreadsheetId || spreadsheets[0]?.id;
    if (idId) usedSpreadsheetIds.add(idId);
    if (entry.config.data) {
      for (const ds of Object.values(entry.config.data)) {
        const dsId = ds.spreadsheetId || spreadsheets[0]?.id;
        if (dsId) usedSpreadsheetIds.add(dsId);
      }
    }
  }
  const hasMissingFetch = accountTypes.length > 0 && [...usedSpreadsheetIds].some((id) => !sheetMeta[id]);

  // Collect all sheet names across spreadsheets for the given spreadsheetId
  const getSheetsForId = (ssId?: string): string[] => {
    if (!ssId) return [];
    return sheetMeta[ssId]?.sheets || [];
  };

  const getColumnsForSheet = (ssId?: string, sheetName?: string): string[] => {
    if (!ssId || !sheetName) return [];
    return sheetMeta[ssId]?.headers?.[sheetName] || [];
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("settings.hubwork.title")}
      </h2>

      {/* Subscription */}
      <SectionCard>
        <div className="flex items-center gap-3 mb-4">
          <CreditCard size={18} className="text-gray-400" />
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              {t("settings.hubwork.subscription")}
            </h3>
            {(plan === "lite" || plan === "pro") && (
              <p className="text-sm text-green-600 dark:text-green-400 mt-0.5">
                {plan === "lite" ? "Lite" : "Pro"} — {t("settings.hubwork.subscriptionActive")}
              </p>
            )}
            {plan === "granted" && (
              <p className="text-sm text-blue-600 dark:text-blue-400 mt-0.5">
                {t("settings.hubwork.subscriptionGranted")}
              </p>
            )}
            {!plan && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {t("settings.hubwork.subscriptionRequired")}
              </p>
            )}
          </div>
        </div>

        {(plan === "lite" || plan === "pro") && (
          <stripeFetcher.Form method="post" action="/hubwork/api/stripe/portal">
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              {stripeFetcher.state !== "idle" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                t("settings.hubwork.manageSubscription")
              )}
            </button>
          </stripeFetcher.Form>
        )}

        {plan === "lite" && (
          <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">Upgrade to Pro</div>
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">¥2,000<span className="text-xs font-normal text-gray-500">/month</span></div>
              <ul className="mt-2 space-y-0.5">
                {["All Lite features", "Google Sheets CRUD", "Static Page Hosting (CDN)", "Custom Domains (auto SSL)", "Scheduled Workflows", "Server-Side Execution", "AI Web Builder"].map((f) => (
                  <li key={f} className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1">
                    <span className="text-green-500 mt-px">•</span>{f}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">
                {t("settings.hubwork.slugLabel")}
              </label>
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                    setSlugError("");
                  }}
                  placeholder="acme"
                  className="w-28 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                />
                <span className="text-xs text-gray-400">.gemihub.online</span>
              </div>
              {slugError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{slugError}</p>
              )}
            </div>
            <stripeFetcher.Form
              method="post"
              action="/hubwork/api/stripe/checkout"
              onSubmit={(e) => {
                if (!slug) {
                  e.preventDefault();
                  setSlugError(t("settings.hubwork.slugRequired"));
                  return;
                }
                if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.length < 3) {
                  e.preventDefault();
                  setSlugError(t("settings.hubwork.slugInvalid"));
                  return;
                }
                setSlugError("");
              }}
            >
              <input type="hidden" name="accountSlug" value={slug} />
              <input type="hidden" name="plan" value="pro" />
              <button
                type="submit"
                disabled
                className="w-full px-4 py-2 text-sm font-medium text-white bg-gray-400 rounded-md cursor-not-allowed opacity-50"
                title="Currently unavailable"
              >
                Upgrade
              </button>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                <AlertCircle size={12} className="inline mr-1 -mt-0.5" />
                New subscriptions are temporarily unavailable while OAuth verification is in progress.
              </p>
            </stripeFetcher.Form>
          </div>
        )}

        {!plan && !isPaidApiKey && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            <AlertCircle size={14} className="inline mr-1 -mt-0.5" />
            {t("settings.hubwork.paidApiKeyRequired")}
          </p>
        )}

        {!plan && isPaidApiKey && (
          <div className="space-y-4">
            {/* Plan cards */}
            <div className="grid grid-cols-2 gap-3">
              {([
                {
                  plan: "lite" as const, price: "¥300",
                  features: ["Interactions API Chat", "Gmail Send", "PDF Generation", "Calendar", "Obsidian Sync Token", "Temp Upload URL", "Max File Size: 5 GB"],
                },
                {
                  plan: "pro" as const, price: "¥2,000",
                  features: ["All Lite features", "Google Sheets CRUD", "Static Page Hosting (CDN)", "Custom Domains (auto SSL)", "Scheduled Workflows", "Server-Side Execution", "AI Web Builder"],
                },
              ]).map(({ plan: p, price, features }) => (
                <div key={p} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="font-medium text-gray-900 dark:text-gray-100 capitalize">{p}</div>
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{price}<span className="text-xs font-normal text-gray-500">/month</span></div>
                  <ul className="mt-2 space-y-0.5 mb-3">
                    {features.map((f) => (
                      <li key={f} className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1">
                        <span className="text-green-500 mt-px">•</span>{f}
                      </li>
                    ))}
                  </ul>
                  {p === "pro" && (
                    <div className="mb-3">
                      <label className="text-xs text-gray-500 dark:text-gray-400">
                        {t("settings.hubwork.slugLabel")}
                      </label>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="text"
                          value={slug}
                          onChange={(e) => {
                            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                            setSlugError("");
                          }}
                          placeholder="acme"
                          className="w-28 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                        />
                        <span className="text-xs text-gray-400">.gemihub.online</span>
                      </div>
                      {slugError && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{slugError}</p>
                      )}
                    </div>
                  )}
                  <stripeFetcher.Form
                    method="post"
                    action="/hubwork/api/stripe/checkout"
                    onSubmit={(e) => {
                      if (p === "pro") {
                        if (!slug) {
                          e.preventDefault();
                          setSlugError(t("settings.hubwork.slugRequired"));
                          return;
                        }
                        if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.length < 3) {
                          e.preventDefault();
                          setSlugError(t("settings.hubwork.slugInvalid"));
                          return;
                        }
                      }
                      setSlugError("");
                    }}
                  >
                    <input type="hidden" name="accountSlug" value={slug} />
                    <input type="hidden" name="plan" value={p} />
                    <button
                      type="submit"
                      disabled
                      className="w-full px-4 py-2 text-sm font-medium text-white bg-gray-400 rounded-md cursor-not-allowed opacity-50"
                      title="Currently unavailable"
                    >
                      Subscribe
                    </button>
                  </stripeFetcher.Form>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    <AlertCircle size={12} className="inline mr-1 -mt-0.5" />
                    New subscriptions are temporarily unavailable while OAuth verification is in progress.
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {isPro && hubwork?.accountSlug && (
        <SectionCard>
          <div className="flex items-center gap-3">
            <Globe size={18} className="text-gray-400" />
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                {t("settings.hubwork.siteUrl")}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 font-mono mt-0.5">
                {hubwork.accountSlug}.gemihub.online
              </p>
            </div>
          </div>
        </SectionCard>
      )}

      {isEnabled && (
        <>
          {/* Scope upgrade banner — Lite needs Gmail, Pro needs Sheets+Gmail */}
          {isEnabled && !hasHubworkScopes && (
            <SectionCard>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    {t("settings.hubwork.scopeUpgradeRequired")}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                    {t("settings.hubwork.scopeUpgradeDescription")}
                  </p>
                </div>
                <a
                  href="/auth/google?hubwork=1"
                  className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 whitespace-nowrap"
                >
                  {t("settings.hubwork.scopeUpgradeButton")}
                </a>
              </div>
            </SectionCard>
          )}

          {/* Pro-only: Spreadsheets, Account Types, Domain, Schedules */}
          {isPro && (
            <>
              {/* Spreadsheets */}
              <SectionCard>
                <h3 className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                  <Database size={16} />
                  {t("settings.hubwork.spreadsheetId")}
                </h3>

                <div className="space-y-3">
                  {spreadsheets.map((ss, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={ss.id}
                          onChange={(e) => {
                            const updated = [...spreadsheets];
                            const newId = parseSpreadsheetId(e.target.value.trim());
                            // Clear old meta if ID changed
                            if (newId !== ss.id) {
                              setSheetMeta((prev) => { const n = { ...prev }; delete n[ss.id]; return n; });
                            }
                            updated[i] = { ...updated[i], id: newId, label: undefined };
                            setSpreadsheets(updated);
                          }}
                          placeholder={t("settings.hubwork.spreadsheetIdPlaceholder")}
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                        />
                        {fetchErrors[ss.id] && (
                          <p className="text-xs text-red-600 dark:text-red-400">{fetchErrors[ss.id]}</p>
                        )}
                        {sheetMeta[ss.id] && (
                          <p className="text-xs text-green-600 dark:text-green-400">
                            {ss.label && <span className="font-medium">{ss.label} — </span>}
                            {sheetMeta[ss.id].sheets.length} sheets: {sheetMeta[ss.id].sheets.join(", ")}
                          </p>
                        )}
                      </div>
                      {savedSSIds.has(ss.id) && sheetMeta[ss.id] ? (
                        <button
                          type="button"
                          onClick={() => {
                            const referencingTypes = accountTypes
                              .filter((at) => {
                                const idSsId = at.config.identity.spreadsheetId || spreadsheets[0]?.id;
                                if (idSsId === ss.id) return true;
                                const dataSources = Object.values(at.config.data || {});
                                return dataSources.some((ds) => (ds.spreadsheetId || spreadsheets[0]?.id) === ss.id);
                              })
                              .map((at) => at.config.identity.sheet || "(unnamed)");
                            if (referencingTypes.length > 0) {
                              alert(t("settings.hubwork.spreadsheetInUse") + "\n" + referencingTypes.join(", "));
                              return;
                            }
                            setSheetMeta((prev) => { const n = { ...prev }; delete n[ss.id]; return n; });
                            setSavedSSIds((prev) => { const n = new Set(prev); n.delete(ss.id); return n; });
                            setSpreadsheets(spreadsheets.filter((_, j) => j !== i));
                          }}
                          className="p-2 text-red-500 hover:text-red-700"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => saveSpreadsheet(ss.id)}
                          disabled={!ss.id.trim() || savingSSIds.has(ss.id)}
                          className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                        >
                          {savingSSIds.has(ss.id) ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <CheckCircle size={14} />
                          )}
                          Save
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setSpreadsheets([...spreadsheets, { id: "" }])}
                  className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline mt-3"
                >
                  <Plus size={14} />
                  {t("settings.hubwork.spreadsheetAdd")}
                </button>

              </SectionCard>

              {/* Account Types (multi-type auth) */}
              <SectionCard>
                <h3 className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                  <Users size={16} />
                  {t("settings.hubwork.accounts")}
                </h3>

                {hasMissingFetch && (
                  <div className="mb-4 flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2">
                    <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {t("settings.hubwork.spreadsheetFetchRequired")}
                    </p>
                  </div>
                )}

                {accountTypes.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("settings.hubwork.accountsEmpty")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {accountTypes.map((entry, i) => (
                      <AccountTypeEditor
                        key={i}
                        entry={entry}
                        spreadsheets={spreadsheets.filter((s) => s.id.trim())}
                        getSheetsForId={getSheetsForId}
                        getColumnsForSheet={getColumnsForSheet}
                        onChange={(updated) => {
                          const list = [...accountTypes];
                          list[i] = updated;
                          setAccountTypes(list);
                        }}
                        onRemove={() => setAccountTypes(accountTypes.filter((_, j) => j !== i))}
                      />
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-4 mt-4">
                  <button
                    onClick={() =>
                      setAccountTypes([
                        ...accountTypes,
                        {
                          config: { identity: { spreadsheetId: spreadsheets[0]?.id, sheet: "", emailColumn: "" } },
                          expanded: true,
                        },
                      ])
                    }
                    className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <Plus size={14} />
                    {t("settings.hubwork.accountAdd")}
                  </button>
                  <button
                    onClick={saveAccounts}
                    disabled={!hasUnsavedAccounts || accountsFetcher.state !== "idle"}
                    className="flex items-center gap-1 px-3 py-1 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {accountsFetcher.state !== "idle" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                    Save
                  </button>
                </div>

              </SectionCard>

              {/* Custom Domain */}
              <SectionCard>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
              <Globe size={16} />
              {t("settings.hubwork.domain")}
            </h3>

            {hubwork?.customDomain ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-gray-700 dark:text-gray-300">
                    {hubwork.customDomain}
                  </span>
                  <DomainStatusBadge status={hubwork.domainStatus} />
                </div>
                <div className="flex gap-2">
                  <domainFetcher.Form method="post" action="/hubwork/api/domain">
                    <input type="hidden" name="intent" value="status" />
                    <input type="hidden" name="accountId" value={hubwork.accountId || ""} />
                    <button
                      type="submit"
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {t("settings.hubwork.domainStatus")}
                    </button>
                  </domainFetcher.Form>
                  <domainFetcher.Form method="post" action="/hubwork/api/domain">
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="accountId" value={hubwork.accountId || ""} />
                    <button
                      type="submit"
                      className="text-sm text-red-600 dark:text-red-400 hover:underline"
                    >
                      {t("settings.hubwork.domainRemove")}
                    </button>
                  </domainFetcher.Form>
                </div>
              </div>
            ) : (
              <domainFetcher.Form method="post" action="/hubwork/api/domain" className="flex gap-2">
                <input type="hidden" name="intent" value="provision" />
                <input type="hidden" name="accountId" value={hubwork?.accountId || ""} />
                <input
                  type="text"
                  name="domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder={t("settings.hubwork.domainPlaceholder")}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
                <button
                  type="submit"
                  disabled={!domain || domainFetcher.state !== "idle"}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {domainFetcher.state !== "idle" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    t("settings.hubwork.domainProvision")
                  )}
                </button>
              </domainFetcher.Form>
            )}

            {domainFetcher.data && (domainFetcher.data as { message?: string }).message && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                {(domainFetcher.data as { message: string }).message}
              </p>
            )}
          </SectionCard>

          {/* Schedules */}
          <SectionCard>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
              <Clock size={16} />
              {t("settings.hubwork.schedules")}
            </h3>

            {schedules.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("settings.hubwork.schedulesEmpty")}
              </p>
            ) : (
              <div className="space-y-3">
                {schedules.map((schedule, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="flex-1 space-y-1">
                      <input
                        type="text"
                        value={schedule.workflowPath}
                        onChange={(e) => {
                          const updated = [...schedules];
                          updated[i] = { ...updated[i], workflowPath: e.target.value };
                          setSchedules(updated);
                        }}
                        placeholder={t("settings.hubwork.scheduleWorkflow")}
                        className="w-full text-sm px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      />
                      <input
                        type="text"
                        value={schedule.cron}
                        onChange={(e) => {
                          const updated = [...schedules];
                          updated[i] = { ...updated[i], cron: e.target.value };
                          setSchedules(updated);
                        }}
                        placeholder={t("settings.hubwork.scheduleCron")}
                        className="w-full text-sm px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono"
                      />
                    </div>
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={schedule.enabled}
                        onChange={(e) => {
                          const updated = [...schedules];
                          updated[i] = { ...updated[i], enabled: e.target.checked };
                          setSchedules(updated);
                        }}
                      />
                      {t("settings.hubwork.scheduleEnabled")}
                    </label>
                    <button
                      onClick={() => setSchedules(schedules.filter((_, j) => j !== i))}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() =>
                  setSchedules([...schedules, { workflowPath: "", cron: "*/5 * * * *", enabled: true }])
                }
                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                <Plus size={14} />
                {t("settings.hubwork.scheduleAdd")}
              </button>
            </div>

            {/* Save schedules */}
            <scheduleFetcher.Form method="post" action="/settings" className="mt-4">
              <input type="hidden" name="_action" value="hubwork-schedules" />
              <input type="hidden" name="schedules" value={JSON.stringify(schedules)} />
              <button
                type="submit"
                disabled={scheduleFetcher.state !== "idle"}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {scheduleFetcher.state !== "idle" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "Save"
                )}
              </button>
            </scheduleFetcher.Form>
          </SectionCard>

              {/* Skill Update */}
              <SectionCard>
                {skillMissing ? (
                  <>
                    <div className="rounded-md border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                            {t("settings.hubwork.skillMissingTitle")}
                          </h3>
                          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                            {t("settings.hubwork.skillMissingDescription")}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={skillUpdating}
                        onClick={async () => {
                          setSkillUpdating(true);
                          setSkillUpdateResult(null);
                          try {
                            const res = await fetch("/api/settings/hubwork-provision", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ force: false }),
                            });
                            const data = await res.json();
                            const files = data.files as Array<{ id: string; name: string; path: string; mimeType: string; content: string; md5Checksum?: string; modifiedTime?: string }> | undefined;
                            if (files && files.length > 0) {
                              const { setCachedFile, getCachedRemoteMeta, setCachedRemoteMeta, getLocalSyncMeta, setLocalSyncMeta, setCachedFileTree } = await import("~/services/indexeddb-cache");
                              const { buildTreeFromMeta } = await import("~/utils/file-tree-operations");
                              const now = new Date().toISOString();
                              for (const f of files) {
                                await setCachedFile({
                                  fileId: f.id,
                                  content: f.content,
                                  md5Checksum: f.md5Checksum || "",
                                  modifiedTime: f.modifiedTime || now,
                                  cachedAt: Date.now(),
                                  fileName: f.path,
                                });
                              }
                              const meta = await getCachedRemoteMeta() ?? { id: "current", rootFolderId: "", lastUpdatedAt: now, files: {}, cachedAt: Date.now() };
                              for (const f of files) {
                                meta.files[f.id] = { name: f.path, mimeType: f.mimeType, md5Checksum: f.md5Checksum || "", modifiedTime: f.modifiedTime || now };
                              }
                              await setCachedRemoteMeta(meta);
                              const localMeta = await getLocalSyncMeta() ?? { id: "current" as const, lastUpdatedAt: now, files: {} };
                              for (const f of files) {
                                localMeta.files[f.id] = { md5Checksum: f.md5Checksum || "", modifiedTime: f.modifiedTime || now, name: f.path };
                              }
                              await setLocalSyncMeta(localMeta);
                              const treeItems = buildTreeFromMeta(meta);
                              await setCachedFileTree({ id: "current", rootFolderId: meta.rootFolderId, items: treeItems, cachedAt: Date.now() });
                              // Activate the skill in localStorage
                              try {
                                const stored = localStorage.getItem("gemihub:activeSkills");
                                const activeSkills: string[] = stored ? JSON.parse(stored) : [];
                                if (!activeSkills.includes("webpage-builder")) {
                                  activeSkills.push("webpage-builder");
                                  localStorage.setItem("gemihub:activeSkills", JSON.stringify(activeSkills));
                                }
                              } catch { /* ignore */ }
                              setSkillMissing(false);
                            }
                            setSkillUpdateResult(res.ok ? "success" : "error");
                          } catch {
                            setSkillUpdateResult("error");
                          } finally {
                            setSkillUpdating(false);
                          }
                        }}
                        className="mt-3 w-full px-4 py-2.5 text-sm font-semibold text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {skillUpdating ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Sparkles size={16} />
                        )}
                        {t("settings.hubwork.skillInstall")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Upload size={18} className="text-gray-400" />
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-gray-100">
                          {t("settings.hubwork.skillUpdate")}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          skills/webpage-builder
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={skillUpdating}
                      onClick={async () => {
                        if (!confirm(t("settings.hubwork.skillUpdateConfirm"))) return;
                        setSkillUpdating(true);
                        setSkillUpdateResult(null);
                        try {
                          const res = await fetch("/api/settings/hubwork-provision", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ force: true }),
                          });
                          const data = await res.json();
                          const files = data.files as Array<{ id: string; name: string; path: string; mimeType: string; content: string; md5Checksum?: string; modifiedTime?: string }> | undefined;
                          if (files && files.length > 0) {
                            const { setCachedFile, getCachedRemoteMeta, setCachedRemoteMeta, getLocalSyncMeta, setLocalSyncMeta, setCachedFileTree } = await import("~/services/indexeddb-cache");
                            const { buildTreeFromMeta } = await import("~/utils/file-tree-operations");
                            const now = new Date().toISOString();
                            for (const f of files) {
                              await setCachedFile({
                                fileId: f.id,
                                content: f.content,
                                md5Checksum: f.md5Checksum || "",
                                modifiedTime: f.modifiedTime || now,
                                cachedAt: Date.now(),
                                fileName: f.path,
                              });
                            }
                            const meta = await getCachedRemoteMeta() ?? { id: "current", rootFolderId: "", lastUpdatedAt: now, files: {}, cachedAt: Date.now() };
                            for (const f of files) {
                              meta.files[f.id] = { name: f.path, mimeType: f.mimeType, md5Checksum: f.md5Checksum || "", modifiedTime: f.modifiedTime || now };
                            }
                            await setCachedRemoteMeta(meta);
                            const localMeta = await getLocalSyncMeta() ?? { id: "current" as const, lastUpdatedAt: now, files: {} };
                            for (const f of files) {
                              localMeta.files[f.id] = { md5Checksum: f.md5Checksum || "", modifiedTime: f.modifiedTime || now, name: f.path };
                            }
                            await setLocalSyncMeta(localMeta);
                            const treeItems = buildTreeFromMeta(meta);
                            await setCachedFileTree({ id: "current", rootFolderId: meta.rootFolderId, items: treeItems, cachedAt: Date.now() });
                          }
                          setSkillUpdateResult(res.ok ? "success" : "error");
                        } catch {
                          setSkillUpdateResult("error");
                        } finally {
                          setSkillUpdating(false);
                        }
                      }}
                      className="px-4 py-2 text-sm bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {skillUpdating ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      {t("settings.hubwork.skillUpdate")}
                    </button>
                  </div>
                )}
                {skillUpdateResult === "success" && (
                  <p className="mt-2 text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                    <CheckCircle size={14} />
                    {t("settings.hubwork.skillUpdateSuccess")}
                  </p>
                )}
                {skillUpdateResult === "error" && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                    <AlertCircle size={14} />
                    {t("settings.hubwork.skillUpdateError")}
                  </p>
                )}
              </SectionCard>
            </>
          )}
        </>
      )}

      {/* Provisioning loading overlay */}
      {provisioning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800 flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-purple-600 dark:text-purple-400" />
            <span className="text-sm text-gray-700 dark:text-gray-300">{t("settings.hubwork.provisioning")}</span>
          </div>
        </div>
      )}

      {/* Welcome dialog after first provision */}
      {showWelcomeDialog && (
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-5 py-4">
              <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                <Sparkles size={20} />
                <h3 className="text-base font-semibold">{t("settings.hubwork.welcomeTitle")}</h3>
              </div>
              <button onClick={() => setShowWelcomeDialog(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <p>{t("settings.hubwork.welcomeDescription")}</p>
              <ul className="list-disc list-inside space-y-1.5 pl-1">
                <li>{t("settings.hubwork.welcomeFeature1")}</li>
                <li>{t("settings.hubwork.welcomeFeature2")}</li>
                <li>{t("settings.hubwork.welcomeFeature3")}</li>
              </ul>
            </div>
            <div className="flex justify-end border-t border-gray-200 dark:border-gray-700 px-5 py-3">
              <button
                onClick={() => setShowWelcomeDialog(false)}
                className="rounded bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountTypeEditor({
  entry,
  spreadsheets,
  getSheetsForId,
  getColumnsForSheet,
  onChange,
  onRemove,
}: {
  entry: AccountTypeEntry;
  spreadsheets: HubworkSpreadsheet[];
  getSheetsForId: (ssId?: string) => string[];
  getColumnsForSheet: (ssId?: string, sheetName?: string) => string[];
  onChange: (updated: AccountTypeEntry) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const [dataSources, setDataSources] = useState<DataSourceEntry[]>(
    dataToEntries(entry.config.data)
  );

  const updateConfig = (patch: Partial<HubworkAccountType>) => {
    onChange({ ...entry, config: { ...entry.config, ...patch } });
  };

  const updateIdentity = (field: string, value: string) => {
    updateConfig({ identity: { ...entry.config.identity, [field]: value } });
  };

  const syncDataSources = (updated: DataSourceEntry[]) => {
    setDataSources(updated);
    updateConfig({ data: entriesToData(updated) });
  };

  const identitySsId = entry.config.identity.spreadsheetId || spreadsheets[0]?.id;
  const identitySheetNames = getSheetsForId(identitySsId);
  const identityColumns = getColumnsForSheet(identitySsId, entry.config.identity.sheet);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => onChange({ ...entry, expanded: !entry.expanded })}
      >
        {entry.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">
          {entry.config.identity.sheet || <span className="text-gray-400 italic">{t("settings.hubwork.accountTypeNamePlaceholder")}</span>}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-red-500 hover:text-red-700"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Body */}
      {entry.expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3">
          {/* Identity */}
          {spreadsheets.length > 1 && (
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("settings.hubwork.selectSpreadsheet")}
              </label>
              <SpreadsheetSelect
                value={entry.config.identity.spreadsheetId || spreadsheets[0]?.id || ""}
                spreadsheets={spreadsheets}
                onChange={(v) => updateIdentity("spreadsheetId", v)}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("settings.hubwork.identitySheet")}
              </label>
              <SheetSelect
                value={entry.config.identity.sheet}
                sheetNames={identitySheetNames}
                onChange={(v) => {
                  // Reset emailColumn when sheet changes and columns are available
                  const newCols = getColumnsForSheet(identitySsId, v);
                  const currentCol = entry.config.identity.emailColumn;
                  const keep = newCols.length === 0 || newCols.includes(currentCol);
                  updateConfig({
                    identity: {
                      ...entry.config.identity,
                      sheet: v,
                      emailColumn: keep ? currentCol : "",
                    },
                  });
                }}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("settings.hubwork.identityEmailColumn")}
              </label>
              <ColumnSelect
                value={entry.config.identity.emailColumn}
                columns={identityColumns}
                onChange={(v) => updateIdentity("emailColumn", v)}
              />
            </div>
          </div>

          {/* Data Sources */}
          <div>
            <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-2">
              <Database size={12} />
              {t("settings.hubwork.dataSources")}
            </label>
            {dataSources.map((ds, j) => (
              <DataSourceEditor
                key={j}
                entry={ds}
                spreadsheets={spreadsheets}
                getSheetsForId={getSheetsForId}
                getColumnsForSheet={getColumnsForSheet}
                onChange={(updated) => {
                  const list = [...dataSources];
                  list[j] = updated;
                  syncDataSources(list);
                }}
                onRemove={() => syncDataSources(dataSources.filter((_, k) => k !== j))}
              />
            ))}
            <button
              onClick={() => syncDataSources([...dataSources, { key: "", source: { spreadsheetId: identitySsId, sheet: "", matchBy: "", fields: [], shape: "object" } }])}
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
            >
              <Plus size={12} />
              {t("settings.hubwork.dataSourceAdd")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DataSourceEditor({
  entry,
  spreadsheets,
  getSheetsForId,
  getColumnsForSheet,
  onChange,
  onRemove,
}: {
  entry: DataSourceEntry;
  spreadsheets: HubworkSpreadsheet[];
  getSheetsForId: (ssId?: string) => string[];
  getColumnsForSheet: (ssId?: string, sheetName?: string) => string[];
  onChange: (updated: DataSourceEntry) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();

  const update = (field: string, value: string | string[] | number | undefined) => {
    onChange({ ...entry, source: { ...entry.source, [field]: value } });
  };

  const dsSpreadsheetId = entry.source.spreadsheetId || spreadsheets[0]?.id;
  const dsSheetNames = getSheetsForId(dsSpreadsheetId);
  const dsColumns = getColumnsForSheet(dsSpreadsheetId, entry.source.sheet);

  return (
    <div className="p-2 mb-2 bg-gray-50 dark:bg-gray-800 rounded space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={entry.key}
          onChange={(e) => onChange({ ...entry, key: e.target.value })}
          placeholder={t("settings.hubwork.dataSourceKey")}
          className="w-24 px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono"
        />
        {spreadsheets.length > 1 && (
          <SpreadsheetSelect
            value={dsSpreadsheetId || ""}
            spreadsheets={spreadsheets}
            onChange={(v) => update("spreadsheetId", v)}
            size="xs"
          />
        )}
        <SheetSelect
          value={entry.source.sheet}
          sheetNames={dsSheetNames}
          onChange={(v) => update("sheet", v)}
          className="flex-1"
          size="xs"
        />
        <ColumnSelect
          value={entry.source.matchBy}
          columns={dsColumns}
          onChange={(v) => update("matchBy", v)}
          size="xs"
        />
        <button onClick={onRemove} className="text-red-500 hover:text-red-700">
          <Trash2 size={12} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={entry.source.fields.join(", ")}
          onChange={(e) => update("fields", e.target.value.split(",").map((f) => f.trim()).filter(Boolean))}
          placeholder={t("settings.hubwork.dataSourceFieldsPlaceholder")}
          className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
        <select
          value={entry.source.shape || "array"}
          onChange={(e) => update("shape", e.target.value as "object" | "array")}
          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        >
          <option value="object">object</option>
          <option value="array">array</option>
        </select>
        <input
          type="number"
          value={entry.source.limit || ""}
          onChange={(e) => update("limit", e.target.value ? parseInt(e.target.value, 10) : undefined)}
          placeholder={t("settings.hubwork.dataSourceLimit")}
          className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
        <input
          type="text"
          value={entry.source.sort || ""}
          onChange={(e) => update("sort", e.target.value || undefined)}
          placeholder={t("settings.hubwork.dataSourceSort")}
          className="w-20 px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
      </div>
    </div>
  );
}

/**
 * Sheet name selector — shows a dropdown if sheet names have been fetched, otherwise a text input.
 */
function SheetSelect({
  value,
  sheetNames,
  onChange,
  className,
  size,
}: {
  value: string;
  sheetNames: string[];
  onChange: (value: string) => void;
  className?: string;
  size?: "xs" | "sm";
}) {
  const py = size === "xs" ? "py-1" : "py-1.5";
  const text = size === "xs" ? "text-xs" : "text-sm";
  const base = `${className || "w-full"} px-2 ${py} ${text} border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100`;

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={sheetNames.length === 0} className={`${base} disabled:opacity-50`}>
      {!value && <option value="">—</option>}
      {sheetNames.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  );
}

function ColumnSelect({
  value,
  columns,
  onChange,
  className,
  size,
}: {
  value: string;
  columns: string[];
  onChange: (value: string) => void;
  className?: string;
  size?: "xs" | "sm";
}) {
  const py = size === "xs" ? "py-1" : "py-1.5";
  const text = size === "xs" ? "text-xs" : "text-sm";
  const base = `${className || "w-full"} px-2 ${py} ${text} border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100`;

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={columns.length === 0} className={`${base} disabled:opacity-50`}>
      {!value && <option value="">—</option>}
      {columns.map((col) => (
        <option key={col} value={col}>{col}</option>
      ))}
    </select>
  );
}

/**
 * Spreadsheet selector — dropdown of registered spreadsheets.
 */
function SpreadsheetSelect({
  value,
  spreadsheets,
  onChange,
  size,
}: {
  value: string;
  spreadsheets: HubworkSpreadsheet[];
  onChange: (value: string) => void;
  size?: "xs" | "sm";
}) {
  const py = size === "xs" ? "py-1" : "py-1.5";
  const text = size === "xs" ? "text-xs" : "text-sm";
  const base = `px-2 ${py} ${text} border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100`;

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
      {spreadsheets.map((ss) => (
        <option key={ss.id} value={ss.id}>{spreadsheetLabel(ss)}</option>
      ))}
    </select>
  );
}

function DomainStatusBadge({ status }: { status?: string }) {
  const { t } = useI18n();
  if (!status || status === "none") return null;

  switch (status) {
    case "active":
      return (
        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle size={12} />
          {t("settings.hubwork.domainStatusActive")}
        </span>
      );
    case "pending_dns":
      return (
        <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
          <AlertCircle size={12} />
          {t("settings.hubwork.domainStatusPendingDns")}
        </span>
      );
    case "provisioning_cert":
      return (
        <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
          <Loader2 size={12} className="animate-spin" />
          {t("settings.hubwork.domainStatusProvisioningCert")}
        </span>
      );
    case "failed":
      return (
        <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle size={12} />
          {t("settings.hubwork.domainStatusFailed")}
        </span>
      );
    default:
      return <span className="text-xs text-gray-500">{status}</span>;
  }
}
