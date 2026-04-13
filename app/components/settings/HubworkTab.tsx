import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Globe, Clock, Plus, Trash2, Loader2, CheckCircle, AlertCircle, CreditCard, RefreshCw, Upload, Sparkles, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { SectionCard } from "~/components/settings/shared";
import type { UserSettings, HubworkSchedule } from "~/types/settings";


export function HubworkTab({ settings, hasHubworkScopes, rootFolderId: _rootFolderId, isCallback }: { settings: UserSettings; hasHubworkScopes: boolean; rootFolderId: string; isCallback?: boolean }) {
  const { t } = useI18n();
  const hubwork = settings.hubwork;
  const domainFetcher = useFetcher();
  const scheduleFetcher = useFetcher();
  const stripeFetcher = useFetcher();
  const [domain, setDomain] = useState(hubwork?.customDomain || "");
  const [schedules, setSchedules] = useState<HubworkSchedule[]>(hubwork?.schedules || []);

  const [slug, setSlug] = useState("");
  const [slugError, setSlugError] = useState("");

  // Surface server-returned "unavailable" errors (e.g. new subscriptions disabled
  // while OAuth verification is in progress) as a slug error message.
  useEffect(() => {
    const data = stripeFetcher.data as { error?: string } | undefined;
    if (data?.error === "unavailable") {
      setSlugError(t("settings.hubwork.slugUnavailable"));
    }
  }, [stripeFetcher.data, t]);
  const [skillUpdating, setSkillUpdating] = useState(false);
  const [skillUpdateResult, setSkillUpdateResult] = useState<"success" | "error" | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [skillMissing, setSkillMissing] = useState(false);
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);

  /** Cache provisioned skill files into IndexedDB and rebuild the file tree. */
  const cacheSkillFiles = useCallback(async (
    files: Array<{ id: string; name: string; path: string; mimeType: string; content: string; md5Checksum?: string; modifiedTime?: string }>,
  ) => {
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
    const meta = await getCachedRemoteMeta() ?? { id: "current" as const, rootFolderId: "", lastUpdatedAt: now, files: {}, cachedAt: Date.now() };
    for (const f of files) {
      meta.files[f.id] = { name: f.path, mimeType: f.mimeType, md5Checksum: f.md5Checksum || "", modifiedTime: f.modifiedTime || now };
    }
    await setCachedRemoteMeta(meta);
    const localMeta = await getLocalSyncMeta() ?? { id: "current" as const, lastUpdatedAt: now, files: {} };
    for (const f of files) {
      localMeta.files[f.id] = { md5Checksum: f.md5Checksum || "", modifiedTime: f.modifiedTime || now, name: f.path };
    }
    await setLocalSyncMeta(localMeta);
    const items = buildTreeFromMeta(meta);
    await setCachedFileTree({ id: "current", rootFolderId: meta.rootFolderId, items, cachedAt: Date.now() });
  }, []);

  // Check whether the webpage-builder skill exists locally; if missing from
  // IndexedDB but present on Drive, silently cache it so the warning doesn't
  // keep appearing on every visit.
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
        if (exists) {
          setSkillMissing(false);
          return;
        }
        // Not in IndexedDB — fetch from Drive via provision endpoint (no-op if already exists)
        const res = await fetch("/api/settings/hubwork-provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        });
        const data = await res.json();
        const files = data.files as Array<{ id: string; name: string; path: string; mimeType: string; content: string; md5Checksum?: string; modifiedTime?: string }> | undefined;
        if (!files || files.length === 0) {
          setSkillMissing(true);
          return;
        }
        await cacheSkillFiles(files);
        setSkillMissing(false);
      } catch { /* ignore */ }
    })();
  }, [hubwork?.plan, cacheSkillFiles]);

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
        await cacheSkillFiles(files);
        setSkillMissing(false);
      } catch { /* best-effort */ }
      finally {
        setProvisioning(false);
      }
    })();
  }, [isCallback, hubwork?.plan, cacheSkillFiles]);


  const plan = hubwork?.plan;
  const isEnabled = !!plan;
  const isPro = plan === "pro" || plan === "granted";
  const isPaidApiKey = settings.apiPlan === "paid";


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
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
              >
                Upgrade
              </button>
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
                      className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Subscribe
                    </button>
                  </stripeFetcher.Form>
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

          {/* Pro-only: Domain, Schedules */}
          {isPro && (
            <>

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
