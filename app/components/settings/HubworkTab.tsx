import { useState, useCallback } from "react";
import { useFetcher } from "react-router";
import { Globe, Clock, Plus, Trash2, Loader2, CheckCircle, AlertCircle, CreditCard, Users, ChevronDown, ChevronRight, Database, RefreshCw } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { SectionCard } from "~/components/settings/shared";
import type { UserSettings, HubworkSchedule, HubworkAccountType, HubworkDataSource } from "~/types/settings";

interface AccountTypeEntry {
  typeName: string;
  config: HubworkAccountType;
  expanded: boolean;
}

interface DataSourceEntry {
  key: string;
  source: HubworkDataSource;
}

function accountsToEntries(accounts?: Record<string, HubworkAccountType>): AccountTypeEntry[] {
  if (!accounts) return [];
  return Object.entries(accounts).map(([typeName, config]) => ({
    typeName,
    config,
    expanded: false,
  }));
}

function entriesToAccounts(entries: AccountTypeEntry[]): Record<string, HubworkAccountType> {
  const result: Record<string, HubworkAccountType> = {};
  for (const entry of entries) {
    if (!entry.typeName.trim()) continue;
    result[entry.typeName.trim()] = entry.config;
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

export function HubworkTab({ settings, hasHubworkScopes }: { settings: UserSettings; hasHubworkScopes: boolean }) {
  const { t } = useI18n();
  const hubwork = settings.hubwork;
  const domainFetcher = useFetcher();
  const scheduleFetcher = useFetcher();
  const stripeFetcher = useFetcher();
  const accountsFetcher = useFetcher();

  const [domain, setDomain] = useState(hubwork?.customDomain || "");
  const [schedules, setSchedules] = useState<HubworkSchedule[]>(hubwork?.schedules || []);
  const [spreadsheetId, setSpreadsheetId] = useState(hubwork?.spreadsheetId || "");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetsFetching, setSheetsFetching] = useState(false);
  const [sheetsError, setSheetsError] = useState("");
  const [accountTypes, setAccountTypes] = useState<AccountTypeEntry[]>(
    accountsToEntries(hubwork?.accounts)
  );

  const [slug, setSlug] = useState("");
  const [slugError, setSlugError] = useState("");

  const fetchSheetNames = useCallback(async () => {
    if (!spreadsheetId.trim()) return;
    setSheetsFetching(true);
    setSheetsError("");
    try {
      const res = await fetch(`/api/settings/hubwork-sheets?spreadsheetId=${encodeURIComponent(spreadsheetId)}`);
      const data = await res.json();
      if (data.error) {
        setSheetsError(data.error);
        setSheetNames([]);
      } else {
        setSheetNames(data.sheets || []);
      }
    } catch {
      setSheetsError("Failed to fetch");
      setSheetNames([]);
    } finally {
      setSheetsFetching(false);
    }
  }, [spreadsheetId]);

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

        {!plan && !isPaidApiKey && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            <AlertCircle size={14} className="inline mr-1 -mt-0.5" />
            {t("settings.hubwork.paidApiKeyRequired")}
          </p>
        )}

        {!plan && isPaidApiKey && (
          <div className="space-y-4">
            {/* Slug input */}
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
                  className="w-32 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                />
                <span className="text-xs text-gray-400">.gemihub.online</span>
              </div>
              {slugError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{slugError}</p>
              )}
            </div>

            {/* Plan selection */}
            <div className="grid grid-cols-2 gap-3">
              {([
                { plan: "lite", price: "¥300", features: "Gmail / PDF / No upload limit" },
                { plan: "pro", price: "¥2,000", features: "Lite + Sheets / Web / Scheduler" },
              ] as const).map(({ plan: p, price, features }) => (
                <stripeFetcher.Form
                  key={p}
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
                  <input type="hidden" name="plan" value={p} />
                  <button
                    type="submit"
                    disabled={stripeFetcher.state !== "idle"}
                    className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-left"
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100 capitalize">{p}</div>
                    <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{price}<span className="text-xs font-normal text-gray-500">/month</span></div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{features}</div>
                  </button>
                </stripeFetcher.Form>
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

          {/* Pro-only: Spreadsheet, Account Types, Domain, Schedules */}
          {isPro && (
            <>
              {/* Spreadsheet ID */}
              <SectionCard>
                <h3 className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                  <Database size={16} />
                  {t("settings.hubwork.spreadsheetId")}
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={spreadsheetId}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
                      setSpreadsheetId(match ? match[1] : raw);
                      setSheetNames([]);
                      setSheetsError("");
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/... or ID"
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                  />
                  <button
                    type="button"
                    onClick={fetchSheetNames}
                    disabled={!spreadsheetId.trim() || sheetsFetching}
                    className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    {sheetsFetching ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Fetch
                  </button>
                </div>
                {sheetsError && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">{sheetsError}</p>
                )}
                {sheetNames.length > 0 && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    {sheetNames.length} sheets: {sheetNames.join(", ")}
                  </p>
                )}
                <accountsFetcher.Form method="post" action="/settings" className="mt-4">
                  <input type="hidden" name="_action" value="hubwork-accounts" />
                  <input type="hidden" name="spreadsheetId" value={spreadsheetId} />
                  <input type="hidden" name="accounts" value={JSON.stringify(entriesToAccounts(accountTypes))} />
                  <button
                    type="submit"
                    disabled={accountsFetcher.state !== "idle"}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {accountsFetcher.state !== "idle" ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </button>
                </accountsFetcher.Form>
              </SectionCard>

              {/* Account Types (multi-type auth) */}
              <SectionCard>
                <h3 className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                  <Users size={16} />
                  {t("settings.hubwork.accounts")}
                </h3>

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
                        sheetNames={sheetNames}
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

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() =>
                      setAccountTypes([
                        ...accountTypes,
                        {
                          typeName: "",
                          config: { identity: { sheet: "", emailColumn: "email" } },
                          expanded: true,
                        },
                      ])
                    }
                    className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <Plus size={14} />
                    {t("settings.hubwork.accountAdd")}
                  </button>
                </div>

                <accountsFetcher.Form method="post" action="/settings" className="mt-4">
                  <input type="hidden" name="_action" value="hubwork-accounts" />
                  <input type="hidden" name="spreadsheetId" value={spreadsheetId} />
                  <input type="hidden" name="accounts" value={JSON.stringify(entriesToAccounts(accountTypes))} />
                  <button
                    type="submit"
                    disabled={accountsFetcher.state !== "idle"}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {accountsFetcher.state !== "idle" ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </button>
                </accountsFetcher.Form>
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
            </>
          )}
        </>
      )}
    </div>
  );
}

function AccountTypeEditor({
  entry,
  sheetNames,
  onChange,
  onRemove,
}: {
  entry: AccountTypeEntry;
  sheetNames: string[];
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

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => onChange({ ...entry, expanded: !entry.expanded })}
      >
        {entry.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">
          {entry.typeName || <span className="text-gray-400 italic">{t("settings.hubwork.accountTypeNamePlaceholder")}</span>}
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
          {/* Type Name */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t("settings.hubwork.accountTypeName")}
            </label>
            <input
              type="text"
              value={entry.typeName}
              onChange={(e) => onChange({ ...entry, typeName: e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() })}
              placeholder={t("settings.hubwork.accountTypeNamePlaceholder")}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
            />
          </div>

          {/* Identity */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("settings.hubwork.identitySheet")}
              </label>
              <SheetSelect
                value={entry.config.identity.sheet}
                sheetNames={sheetNames}
                onChange={(v) => updateIdentity("sheet", v)}
                placeholder="Partners"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t("settings.hubwork.identityEmailColumn")}
              </label>
              <input
                type="text"
                value={entry.config.identity.emailColumn}
                onChange={(e) => updateIdentity("emailColumn", e.target.value)}
                placeholder="email"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
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
                sheetNames={sheetNames}
                onChange={(updated) => {
                  const list = [...dataSources];
                  list[j] = updated;
                  syncDataSources(list);
                }}
                onRemove={() => syncDataSources(dataSources.filter((_, k) => k !== j))}
              />
            ))}
            <button
              onClick={() => syncDataSources([...dataSources, { key: "", source: { sheet: "", matchBy: "email", fields: [], shape: "object" } }])}
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
  sheetNames,
  onChange,
  onRemove,
}: {
  entry: DataSourceEntry;
  sheetNames: string[];
  onChange: (updated: DataSourceEntry) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();

  const update = (field: string, value: string | string[] | number | undefined) => {
    onChange({ ...entry, source: { ...entry.source, [field]: value } });
  };

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
        <SheetSelect
          value={entry.source.sheet}
          sheetNames={sheetNames}
          onChange={(v) => update("sheet", v)}
          placeholder={t("settings.hubwork.dataSourceSheet")}
          className="flex-1"
          size="xs"
        />
        <input
          type="text"
          value={entry.source.matchBy}
          onChange={(e) => update("matchBy", e.target.value)}
          placeholder={t("settings.hubwork.dataSourceMatchBy")}
          className="w-24 px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
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
  placeholder,
  className,
  size,
}: {
  value: string;
  sheetNames: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  size?: "xs" | "sm";
}) {
  const py = size === "xs" ? "py-1" : "py-1.5";
  const text = size === "xs" ? "text-xs" : "text-sm";
  const base = `${className || "w-full"} px-2 ${py} ${text} border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100`;

  if (sheetNames.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">{placeholder || "Select sheet"}</option>
        {sheetNames.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={base}
    />
  );
}

function DomainStatusBadge({ status }: { status?: string }) {
  if (!status || status === "none") return null;
  const { t } = useI18n();

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
