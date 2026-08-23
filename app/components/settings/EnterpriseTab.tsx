import { useEffect, useState } from "react";
import { useEnterpriseContext } from "~/contexts/EnterpriseContext";
import { useI18n } from "~/i18n/context";
import { VERTEX_TOPUP_UNIT_JPY, VERTEX_TOPUP_UNIT_USD, VERTEX_TOPUP_UNIT_CREDIT_USD } from "~/types/hubwork";
import type { OrganizationAiSettings, OrgRole } from "~/types/enterprise";

interface OrgItem { id: string; name: string; role: OrgRole | null }
interface ProjectItem { id: string }
interface OrgMemberItem { uid: string; email: string; role: OrgRole; monthlyBudgetUsdOverride?: number | null }
interface UsageSummary { estimatedCostUsd: number; inputTokens: number; outputTokens: number; topUpUsd?: number }
interface AiPayload {
  settings: OrganizationAiSettings;
  usage?: { organization?: UsageSummary; users?: Record<string, UsageSummary> };
  oauthStatus?: { connected: boolean; connectedEmail: string | null; connectedAt: number | null; clientConfigured: boolean; projectId: string | null; source: "default" | "own"; serviceDefault: { connected: boolean } };
  budget?: {
    periodStart?: string;
    periodEnd?: string;
    followsBillingCycle?: boolean;
    includedUsd: number;
    configuredUsd: number | null;
    topUpUsd: number;
    topUpPurchasedThisMonthUsd?: number;
    topUpCarriedOverUsd?: number;
    topUpExpiresOn?: string;
    limitUsd: number | null;
  };
  storage?: { usedBytes: number | null; quotaGb: number; includedGb: number; addonUnits: number };
}
type SectionId = "members" | "ai" | "storage";

async function api<T>(url: string, options?: { method?: string; body?: object }): Promise<T> {
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}


const inputClass = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900";
const cardClass = "rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900";
const primaryButton = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800";

export function EnterpriseTab() {
  const { t } = useI18n();
  const enterprise = useEnterpriseContext();
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [members, setMembers] = useState<OrgMemberItem[]>([]);
  const [orgId, setOrgId] = useState(enterprise.currentOrgId ?? "");
  const [section, setSection] = useState<SectionId>("members");
  const [ai, setAi] = useState<AiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "warning" | "error"; text: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isSuperOwner, setIsSuperOwner] = useState(false);

  const currentOrg = orgs.find((org) => org.id === orgId);
  const role = currentOrg?.role ?? null;
  const canManage = role === "owner" || role === "admin";

  useEffect(() => {
    void api<{ organizations: OrgItem[]; isSuperOwner?: boolean }>("/api/orgs/list")
      .then(({ organizations, isSuperOwner: superOwner }) => {
        setOrgs(organizations);
        setIsSuperOwner(superOwner === true);
        if (organizations.length === 1) setOrgId((current) => current || organizations[0].id);
      })
      .catch((error) => setMessage({ kind: "error", text: error.message }));
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("vertexOAuth") !== "connected") return;
    setSection("ai");
    setMessage({ kind: "success", text: t("enterprise.aiSettingsSaved") });
    url.searchParams.delete("vertexOAuth");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [t]);

  useEffect(() => {
    if (!orgId) {
      setMembers([]); setAi(null); setLoading(false); return;
    }
    let cancelled = false;
    setLoading(true);
    const encoded = encodeURIComponent(orgId);
    const orgRole = orgs.find((org) => org.id === orgId)?.role;
    const requests: Promise<unknown>[] = [];
    if (orgRole === "owner" || orgRole === "admin") {
      requests.push(api<{ members: OrgMemberItem[] }>(`/api/members/list?orgId=${encoded}`).then((value) => {
        if (!cancelled) setMembers(value.members);
      }));
    } else {
      setMembers([]);
    }
    if (orgRole === "owner" || orgRole === "admin") {
      requests.push(
        api<AiPayload>(`/api/orgs/ai-settings?orgId=${encoded}`).then((value) => { if (!cancelled) setAi(value); }),
      );
    } else {
      setAi(null);
    }
    void Promise.all(requests)
      .catch((error) => { if (!cancelled) setMessage({ kind: "error", text: error.message }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, orgs, reloadKey]);

  async function run(task: () => Promise<unknown>, success?: string) {
    setBusy(true); setMessage(null);
    try {
      // A task may report partial success (e.g. the invite was created but the
      // notification email could not be sent) by returning { warning }.
      const result = await task();
      const warning = (result as { warning?: string } | undefined)?.warning;
      setMessage(warning ? { kind: "warning", text: warning } : success ? { kind: "success", text: success } : null);
      setReloadKey((key) => key + 1);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("enterprise.opFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function selectOrganization(nextOrgId: string) {
    setOrgId(nextOrgId);
    setSection("members");
    if (!nextOrgId) return;

    setBusy(true);
    setMessage(null);
    try {
      const { projects: available } = await api<{ projects: ProjectItem[] }>(
        `/api/projects/list?orgId=${encodeURIComponent(nextOrgId)}`,
      );
      const selected = available.find((project) => project.id === "default")
        ?? (available.length === 1 ? available[0] : null);
      await api("/api/session/select", {
        method: "POST",
        body: { orgId: nextOrgId, projectId: selected?.id ?? null },
      });
      window.location.href = "/settings?tab=enterprise";
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("enterprise.orgSelectFailed") });
      setBusy(false);
    }
  }

  const tabs: Array<{ id: SectionId; label: string; visible: boolean }> = [
    { id: "members", label: t("enterprise.tabMembers"), visible: canManage },
    { id: "ai", label: t("enterprise.tabAi"), visible: canManage },
    { id: "storage", label: t("enterprise.tabStorage"), visible: canManage && !!ai?.storage },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t("enterprise.title")}</h2>
        <p className="mt-1 text-sm text-gray-500">{t("enterprise.subtitle")}</p>
      </div>

      {message && <div className={`rounded-lg border p-3 text-sm ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : message.kind === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-green-200 bg-green-50 text-green-700"}`}>{message.text}</div>}

      {orgs.length > 1 && <section className={cardClass}>
        <label className="text-sm font-medium">{t("enterprise.orgSelectLabel")}</label>
        <select className={`${inputClass} mt-2`} value={orgId} disabled={busy} onChange={(event) => void selectOrganization(event.target.value)}>
          <option value="">{t("enterprise.orgSelectPlaceholder")}</option>
          {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}（{org.role === "member" ? t("enterprise.roleMember") : t("enterprise.roleAdmin")}）</option>)}
        </select>
      </section>}

      {orgId && (
        <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800" aria-label={t("enterprise.title")}>
          {tabs.filter((tab) => tab.visible).map((tab) => (
            <button key={tab.id} onClick={() => setSection(tab.id)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${section === tab.id ? "border-blue-500 font-medium text-blue-600" : "border-transparent text-gray-500"}`}>{tab.label}</button>
          ))}
        </nav>
      )}

      {loading && <p className="text-sm text-gray-500">{t("enterprise.loading")}</p>}
      {!orgId && <div className={cardClass}><p className="text-sm text-gray-600">{t("enterprise.noOrgSelected")}</p></div>}

      {orgId && section === "ai" && canManage && ai && (
        <AiSection key={orgId} orgId={orgId} initial={ai} busy={busy} run={run} />
      )}
      {orgId && section === "storage" && canManage && ai?.storage && (
        <StorageSection key={orgId} orgId={orgId} initial={ai} busy={busy} />
      )}
      {orgId && section === "members" && canManage && (
        <MembersSection key={orgId} orgId={orgId} members={members} ai={ai} busy={busy} run={run} isSuperOwner={isSuperOwner} />
      )}
    </div>
  );
}

function AiSection({ orgId, initial, busy, run }: { orgId: string; initial: AiPayload; busy: boolean; run: (task: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const { language, t } = useI18n();
  const [project, setProject] = useState(initial.settings.vertexProjectId);
  const [location, setLocation] = useState(initial.settings.vertexLocation || "global");
  const [orgBudget, setOrgBudget] = useState(initial.settings.monthlyBudgetUsd?.toString() ?? "");
  const [userBudget, setUserBudget] = useState(initial.settings.defaultUserMonthlyBudgetUsd?.toString() ?? "");
  const usage = initial.usage?.organization?.estimatedCostUsd ?? 0;
  const budget = initial.budget;
  const topUp = budget?.topUpUsd ?? initial.usage?.organization?.topUpUsd ?? 0;
  const budgetLimit = budget?.limitUsd ?? null;
  const oauth = initial.oauthStatus;
  const saveAiSettings = () => api("/api/orgs/ai-settings", { method: "POST", body: { orgId, vertexProjectId: project, vertexLocation: location, monthlyBudgetUsd: orgBudget || null, defaultUserMonthlyBudgetUsd: userBudget || null } });
  const uploadOAuthJson = async (file: File) => {
    const callbackUrl = `${window.location.origin}/auth/vertex/callback`;
    const document = JSON.parse(await file.text()) as { web?: { client_id?: string; client_secret?: string; project_id?: string; redirect_uris?: string[] }; installed?: unknown };
    if (!document.web && document.installed) throw new Error(t("enterprise.vertexOauthDesktopError").replace("{url}", callbackUrl));
    const web = document.web;
    if (!web?.client_id || !web.client_secret || !web.project_id || !Array.isArray(web.redirect_uris)) {
      throw new Error(t("enterprise.vertexOauthJsonError"));
    }
    return api("/api/orgs/vertex-oauth", { method: "POST", body: { orgId, clientId: web.client_id, clientSecret: web.client_secret, projectId: web.project_id, redirectUris: web.redirect_uris } });
  };
  return <div className="space-y-4">
    <section className={cardClass}>
      <h3 className="font-semibold">{t("enterprise.vertexSourceTitle")}</h3>
      <p className="mt-1 text-xs text-gray-500">{t("enterprise.vertexSourceDescription")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || oauth?.source === "default"} className={`${secondaryButton} ${oauth?.source === "default" ? "border-blue-500 bg-blue-50 text-blue-700" : ""}`} onClick={() => void run(() => api("/api/orgs/vertex-oauth", { method: "POST", body: { orgId, source: "default" } }))}>{t("enterprise.vertexPrepaid")}</button>
        <button type="button" disabled={busy || oauth?.source === "own"} className={`${secondaryButton} ${oauth?.source === "own" ? "border-blue-500 bg-blue-50 text-blue-700" : ""}`} onClick={() => void run(() => api("/api/orgs/vertex-oauth", { method: "POST", body: { orgId, source: "own" } }))}>{t("enterprise.vertexOwn")}</button>
      </div>
      {oauth?.source === "own" && (
        <div className="mt-4 space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <p className="text-xs text-gray-500">{t("enterprise.vertexOwnBillingNote")}</p>
          <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-950/30">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100">{t("enterprise.vertexOauthJsonTitle")}</h4>
            <p className="mt-1 text-xs text-gray-500">{t("enterprise.vertexOauthJsonDescription")}</p>
            {oauth.projectId && <p className="mt-2 text-xs text-gray-500">{t("enterprise.vertexOauthClientProject").replace("{project}", oauth.projectId)}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className={`${primaryButton} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
                {t("enterprise.vertexOauthJsonSelect")}
                <input type="file" accept="application/json,.json" className="hidden" disabled={busy} onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void run(() => uploadOAuthJson(file), t("enterprise.vertexOauthJsonSaved"));
                }} />
              </label>
              {oauth.connected
                ? <span className="text-green-600">{t("enterprise.vertexConnected").replace("{email}", oauth.connectedEmail || "")}</span>
                : <a href={`/auth/vertex/start?orgId=${encodeURIComponent(orgId)}`} className={primaryButton}>{t("enterprise.vertexConnect")}</a>}
              {oauth.connected && <button type="button" className="text-red-600 hover:underline" onClick={() => void run(() => api("/api/orgs/vertex-oauth", { method: "DELETE", body: { orgId } }), t("enterprise.vertexDisconnected"))}>{t("enterprise.vertexDisconnect")}</button>}
            </div>
            <p className="mt-2 text-xs text-gray-500">{t("enterprise.vertexOauthRedirectUri").replace("{url}", typeof window === "undefined" ? "/auth/vertex/callback" : `${window.location.origin}/auth/vertex/callback`)}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("enterprise.vertexExecutionProjectId")}><input className={inputClass} value={project} onChange={(e) => setProject(e.target.value)} placeholder="my-vertex-project" /></Field>
            <Field label={t("enterprise.vertexLocation")}><input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} list="vertex-locations-own" /><datalist id="vertex-locations-own"><option value="global" /><option value="asia-northeast1" /><option value="us-central1" /><option value="europe-west4" /></datalist></Field>
          </div>
          <button type="button" className={primaryButton} disabled={busy || !project || !location} onClick={() => void run(saveAiSettings, t("enterprise.aiSettingsSaved"))}>{t("enterprise.saveAiSettings")}</button>
        </div>
      )}
    </section>
    {oauth?.source !== "own" && <section className={cardClass}>
      <h3 className="font-semibold">{t("enterprise.budgetTitle")}</h3>
      <p className="mt-1 text-sm text-gray-500">
        {budgetLimit != null
          ? t("enterprise.budgetUsage")
              .replace("{used}", usage.toFixed(2))
              .replace("{limit}", budgetLimit.toFixed(2))
          : `${t("enterprise.usageThisMonth")}$${usage.toFixed(2)}`}
        {budget && (
          <span className="ml-2">
            {(topUp > 0
              ? t("enterprise.budgetIncludedWithTopUp").replace("{topUp}", topUp.toFixed(2))
              : t("enterprise.budgetIncluded")
            ).replace("{included}", budget.includedUsd.toFixed(2))}
          </span>
        )}
      </p>
      {budget?.periodStart && budget?.periodEnd && (
        <p className="mt-1 text-xs text-gray-500">
          {t("enterprise.budgetPeriod")
            .replace("{start}", budget.periodStart)
            .replace("{end}", budget.periodEnd)}
        </p>
      )}
      {topUp > 0 && budget?.topUpExpiresOn && (
        <p className="mt-1 text-xs text-gray-500">
          {t("enterprise.topUpExpiry").replace("{date}", budget.topUpExpiresOn)}
          {(budget.topUpCarriedOverUsd ?? 0) > 0 && (
            <>{" "}{t("enterprise.topUpCarriedOver").replace("{amount}", (budget.topUpCarriedOverUsd ?? 0).toFixed(2))}</>
          )}
        </p>
      )}
      {budgetLimit != null && budgetLimit > 0 && (
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
          <div
            className={`h-full ${usage / budgetLimit > 0.9 ? "bg-red-500" : "bg-blue-500"}`}
            style={{ width: `${Math.min(100, (usage / budgetLimit) * 100)}%` }}
          />
        </div>
      )}
      <form method="POST" action="/hubwork/api/stripe/checkout" className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="plan" value="vertex-topup" />
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="currency" value={language === "ja" ? "jpy" : "usd"} />
        <select name="units" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" defaultValue="1">
          {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>
            {language === "ja"
              ? `¥${(n * VERTEX_TOPUP_UNIT_JPY).toLocaleString("ja-JP")}（$${n * VERTEX_TOPUP_UNIT_CREDIT_USD}分）`
              : `$${n * VERTEX_TOPUP_UNIT_USD}`}
          </option>)}
        </select>
        <button type="submit" className={secondaryButton} disabled={busy}>{t("enterprise.buyTopUp")}</button>
      </form>
      <p className="mt-1 text-xs text-gray-500">{t("settings.general.vertexTopupCreditNote")}</p>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-300">{t("enterprise.budgetAdvanced")}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t("enterprise.orgMonthlyLimit")}><input className={inputClass} type="number" min="0" step="0.01" value={orgBudget} onChange={(e) => setOrgBudget(e.target.value)} placeholder={t("enterprise.unlimited")} /></Field>
        <Field label={t("enterprise.userMonthlyLimit")}><input className={inputClass} type="number" min="0" step="0.01" value={userBudget} onChange={(e) => setUserBudget(e.target.value)} placeholder={t("enterprise.unlimited")} /></Field>
        </div>
        <button className={`${primaryButton} mt-4`} disabled={busy} onClick={() => void run(saveAiSettings, t("enterprise.aiSettingsSaved"))}>{t("enterprise.saveAiSettings")}</button>
      </details>
    </section>}
  </div>;
}

function StorageSection({ orgId, initial, busy }: { orgId: string; initial: AiPayload; busy: boolean }) {
  const { t } = useI18n();
  const storage = initial.storage;
  if (!storage) return null;
  const storageUsedGb = storage.usedBytes != null ? storage.usedBytes / 1_000_000_000 : null;
  return <div className="space-y-4">
    <section className={cardClass}>
      <h3 className="font-semibold">{t("enterprise.storageTitle")}</h3>
      <p className="mt-1 text-sm text-gray-500">
        {storageUsedGb != null
          ? t("enterprise.storageUsage")
              .replace("{used}", storageUsedGb.toFixed(2))
              .replace("{quota}", String(storage.quotaGb))
          : `— / ${storage.quotaGb} GB`}
        {storage.addonUnits > 0 && (
          <span className="ml-2">
            {t("enterprise.storageAddonActive").replace("{units}", String(storage.addonUnits))}
          </span>
        )}
      </p>
      {storageUsedGb != null && (
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
          <div
            className={`h-full ${storageUsedGb / storage.quotaGb > 0.9 ? "bg-red-500" : "bg-blue-500"}`}
            style={{ width: `${Math.min(100, (storageUsedGb / storage.quotaGb) * 100)}%` }}
          />
        </div>
      )}
      {storageUsedGb != null && storageUsedGb >= storage.quotaGb && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {t("enterprise.storageFull")}
        </p>
      )}
      <p className="mt-3 text-xs leading-5 text-gray-500">
        {t("enterprise.storageIncluded").replace("{included}", String(storage.includedGb))}
      </p>
      {storage.addonUnits > 0 ? (
        <p className="mt-3 text-xs leading-5 text-gray-500">{t("enterprise.storageAddonMaxed")}</p>
      ) : (
      <form method="POST" action="/hubwork/api/stripe/checkout" className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="plan" value="storage-addon" />
        <input type="hidden" name="orgId" value={orgId} />
        {/* One add-on per organization, so there is no quantity to choose. */}
        <input type="hidden" name="units" value="1" />
        <select name="currency" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" defaultValue="jpy">
          <option value="jpy">{t("enterprise.storageJpy")}</option>
          <option value="usd">{t("enterprise.storageUsd")}</option>
        </select>
        <button type="submit" className={secondaryButton} disabled={busy}>{t("enterprise.buyStorage")}</button>
      </form>
      )}
    </section>
  </div>;
}

function MembersSection({ orgId, members, ai, busy, run, isSuperOwner }: { orgId: string; members: OrgMemberItem[]; ai: AiPayload | null; busy: boolean; run: (task: () => Promise<unknown>, success: string) => Promise<void>; isSuperOwner: boolean }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [ownerEmail, setOwnerEmail] = useState("");
  return <div className="space-y-4">
    <section className={cardClass}>
      <h3 className="font-semibold">{t("enterprise.addMember")}</h3>
      <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("enterprise.addMemberDesc")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px_auto]"><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" /><select className={inputClass} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as OrgRole)}><option value="member">{t("enterprise.roleMember")}</option><option value="admin">{t("enterprise.roleAdmin")}</option></select><button className={primaryButton} disabled={busy || !email} onClick={() => void run(async () => {
        // Direct add: the membership takes effect immediately and the member
        // signs in with Google. The mail is only a notification, so a delivery
        // failure is reported without undoing (or retrying) the add.
        const result = await api<{ emailSent?: boolean; warning?: string }>("/api/members/add", { method: "POST", body: { orgId, email, role: inviteRole } });
        setEmail("");
        if (result.emailSent !== false) return undefined;
        return {
          warning: t(
            result.warning === "gmail_scope_missing"
              ? "enterprise.memberAddedGmailScopeMissing"
              : "enterprise.memberAddedEmailFailed",
          ).replace("{email}", email),
        };
      }, t("enterprise.memberAdded"))}>{t("enterprise.add")}</button></div>
    </section>
    {isSuperOwner && <details className={cardClass}><summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-300">{t("enterprise.superOwnerAddOwner")}</summary><p className="mt-3 text-xs leading-5 text-gray-500">{t("enterprise.superOwnerAddOwnerDesc")}</p><div className="mt-3 flex flex-col gap-3 sm:flex-row"><input className={inputClass} type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@example.com" /><button className={primaryButton} disabled={busy || !ownerEmail} onClick={() => void run(async () => { await api("/api/members/add", { method: "POST", body: { orgId, email: ownerEmail, role: "owner" } }); setOwnerEmail(""); }, t("enterprise.ownerAdded"))}>{t("enterprise.addAsOwner")}</button></div></details>}
    <section className={`${cardClass} overflow-x-auto`}><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">{t("enterprise.colEmail")}</th><th className="p-2">{t("enterprise.colRole")}</th><th className="p-2">{t("enterprise.colUsage")}</th><th className="p-2">{t("enterprise.colActions")}</th></tr></thead><tbody>{members.map((member) => <MemberRow key={member.uid} orgId={orgId} member={member} ai={ai} busy={busy} run={run} />)}</tbody></table></section>
  </div>;
}

function MemberRow({ orgId, member, ai, busy, run }: { orgId: string; member: OrgMemberItem; ai: AiPayload | null; busy: boolean; run: (task: () => Promise<unknown>, success: string) => Promise<void> }) {
  const { t } = useI18n();
  const [budget, setBudget] = useState(member.monthlyBudgetUsdOverride?.toString() ?? "");
  const usage = ai?.usage?.users?.[member.uid]?.estimatedCostUsd ?? 0;
  return <tr className="border-b border-gray-100"><td className="p-2">{member.email}</td><td className="p-2">{member.role === "owner" ? <span className="font-medium">Owner</span> : <select className="rounded border px-2 py-1 dark:bg-gray-900" value={member.role} disabled={busy} onChange={(e) => void run(() => api("/api/members/update-role", { method: "POST", body: { orgId, uid: member.uid, role: e.target.value } }), t("enterprise.roleChanged"))}><option value="member">{t("enterprise.roleMember")}</option><option value="admin">{t("enterprise.roleAdmin")}</option></select>}</td><td className="p-2"><div className="flex items-center gap-2"><span>${usage.toFixed(2)} /</span><input className="w-24 rounded border px-2 py-1 dark:bg-gray-900" type="number" min="0.01" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={ai?.settings.defaultUserMonthlyBudgetUsd?.toString() ?? t("enterprise.unlimited")} /><button className="text-blue-600" disabled={busy} onClick={() => void run(() => api("/api/members/ai-budget", { method: "POST", body: { orgId, uid: member.uid, monthlyBudgetUsdOverride: budget || null } }), t("enterprise.budgetSaved"))}>{t("enterprise.save")}</button></div></td><td className="p-2"><button className="text-red-600" disabled={busy} onClick={() => confirm(t("enterprise.confirmRemoveOrgMember").replace("{email}", member.email)) && void run(() => api("/api/members/remove", { method: "POST", body: { orgId, uid: member.uid } }), t("enterprise.memberRemoved"))}>{t("enterprise.delete")}</button></td></tr>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
