import { useEffect, useState } from "react";
import { useEnterpriseContext } from "~/contexts/EnterpriseContext";
import { useI18n } from "~/i18n/context";
import type { OrganizationAiSettings, OrgRole, ProjectRole } from "~/types/enterprise";

interface OrgItem { id: string; name: string; role: OrgRole | null }
interface ProjectItem { id: string; orgId: string; name: string; role: ProjectRole | null }
interface OrgMemberItem { uid: string; email: string; role: OrgRole; monthlyBudgetUsdOverride?: number | null }
interface ProjectMemberItem { uid: string; email: string; role: ProjectRole; isExternal?: boolean }
interface UsageSummary { estimatedCostUsd: number; inputTokens: number; outputTokens: number; topUpUsd?: number }
interface AiPayload {
  settings: OrganizationAiSettings;
  usage?: { organization?: UsageSummary; users?: Record<string, UsageSummary> };
  oauthStatus?: { connected: boolean; connectedEmail: string | null; connectedAt: number | null; clientConfigured: boolean; projectId: string | null };
  storage?: { usedBytes: number | null; quotaGb: number; includedGb: number; addonUnits: number };
}
type SectionId = "ai" | "members" | "projects";

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
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [members, setMembers] = useState<OrgMemberItem[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMemberItem[]>([]);
  const [orgId, setOrgId] = useState(enterprise.currentOrgId ?? "");
  const [projectId, setProjectId] = useState(enterprise.currentProjectId ?? "");
  const [section, setSection] = useState<SectionId>("members");
  const [ai, setAi] = useState<AiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
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
    if (!orgId) {
      setProjects([]); setMembers([]); setAi(null); setLoading(false); return;
    }
    let cancelled = false;
    setLoading(true);
    const encoded = encodeURIComponent(orgId);
    const orgRole = orgs.find((org) => org.id === orgId)?.role;
    const requests: Promise<unknown>[] = [
      api<{ projects: ProjectItem[] }>(`/api/projects/list?orgId=${encoded}`).then((value) => {
        if (!cancelled) setProjects(value.projects);
      }),
    ];
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

  useEffect(() => {
    if (!orgId || !projectId || !canManage) { setProjectMembers([]); return; }
    void api<{ members: ProjectMemberItem[] }>(`/api/members/list?orgId=${encodeURIComponent(orgId)}&projectId=${encodeURIComponent(projectId)}`)
      .then(({ members: rows }) => setProjectMembers(rows))
      .catch((error) => setMessage({ kind: "error", text: error.message }));
  }, [orgId, projectId, canManage, reloadKey]);

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage(null);
    try {
      await task();
      setMessage({ kind: "success", text: success });
      setReloadKey((key) => key + 1);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("enterprise.opFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function selectContext(nextOrgId: string, nextProjectId: string | null) {
    await api("/api/session/select", { method: "POST", body: { orgId: nextOrgId || null, projectId: nextProjectId } });
    window.location.href = "/settings?tab=enterprise";
  }

  async function selectOrganization(nextOrgId: string) {
    setOrgId(nextOrgId);
    setProjectId("");
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
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t("enterprise.title")}</h2>
        <p className="mt-1 text-sm text-gray-500">{t("enterprise.subtitle")}</p>
      </div>

      {message && <div className={`rounded-lg border p-3 text-sm ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>{message.text}</div>}

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

      {orgId && canManage && (
        <details className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
          <summary className="cursor-pointer text-sm font-medium text-gray-500 dark:text-gray-400">{t("enterprise.projectsAdvanced")}</summary>
          <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("enterprise.projectsAdvancedDesc")}</p>
          <button type="button" className={`${secondaryButton} mt-3`} onClick={() => setSection("projects")}>{t("enterprise.openProjects")}</button>
        </details>
      )}

      {loading && <p className="text-sm text-gray-500">{t("enterprise.loading")}</p>}
      {!orgId && <div className={cardClass}><p className="text-sm text-gray-600">{t("enterprise.noOrgSelected")}</p></div>}

      {orgId && section === "ai" && canManage && ai && (
        <AiSection key={orgId} orgId={orgId} initial={ai} busy={busy} run={run} />
      )}
      {orgId && section === "members" && canManage && (
        <MembersSection key={orgId} orgId={orgId} members={members} ai={ai} busy={busy} run={run} isSuperOwner={isSuperOwner} />
      )}
      {orgId && section === "projects" && (
        <ProjectsSection key={orgId} orgId={orgId} projects={projects} projectId={projectId} setProjectId={setProjectId} projectMembers={projectMembers} canManage={canManage} busy={busy} run={run} selectContext={selectContext} />
      )}
    </div>
  );
}

function AiSection({ orgId, initial, busy, run }: { orgId: string; initial: AiPayload; busy: boolean; run: (task: () => Promise<unknown>, success: string) => Promise<void> }) {
  const { t } = useI18n();
  const [project, setProject] = useState(initial.settings.vertexProjectId);
  const [location, setLocation] = useState(initial.settings.vertexLocation || "global");
  const [orgBudget, setOrgBudget] = useState(initial.settings.monthlyBudgetUsd?.toString() ?? "");
  const [userBudget, setUserBudget] = useState(initial.settings.defaultUserMonthlyBudgetUsd?.toString() ?? "");
  const oauth = initial.oauthStatus;
  const usage = initial.usage?.organization?.estimatedCostUsd ?? 0;
  const topUp = initial.usage?.organization?.topUpUsd ?? 0;
  const storage = initial.storage;
  const storageUsedGb = storage?.usedBytes != null ? storage.usedBytes / 1_000_000_000 : null;
  async function loadOAuthJson(file: File) {
    const document = JSON.parse(await file.text()) as {
      web?: { client_id?: string; client_secret?: string; project_id?: string; redirect_uris?: string[] };
      installed?: unknown;
    };
    const web = document.web;
    if (!web && document.installed) {
      throw new Error(t("enterprise.oauthDesktopJsonError").replace("{origin}", window.location.origin));
    }
    if (!web?.client_id || !web.client_secret || !web.project_id || !Array.isArray(web.redirect_uris)) {
      throw new Error(t("enterprise.oauthWebJsonError"));
    }
    await api("/api/orgs/vertex-oauth", {
      method: "POST",
      body: { orgId, clientId: web.client_id, clientSecret: web.client_secret, projectId: web.project_id, redirectUris: web.redirect_uris },
    });
    await api("/api/orgs/ai-settings", {
      method: "POST",
      body: { orgId, vertexProjectId: web.project_id, vertexLocation: location, monthlyBudgetUsd: orgBudget || null, defaultUserMonthlyBudgetUsd: userBudget || null },
    });
    setProject(web.project_id);
  }
  return <div className="space-y-4">
    <section className={cardClass}>
      <h3 className="font-semibold">{t("enterprise.connectVertex")}</h3>
      <p className="mt-1 text-sm text-gray-500">{t("enterprise.connectVertexDesc")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className={`${secondaryButton} cursor-pointer`}>
          {t("enterprise.selectOauthJson")}
          <input type="file" accept="application/json,.json" className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(() => loadOAuthJson(file), t("enterprise.oauthLoaded")); }} />
        </label>
        {oauth?.clientConfigured && <span className="text-sm text-gray-600 dark:text-gray-300">{t("enterprise.configured")}{oauth.projectId}</span>}
      </div>
      {oauth?.connected ? <div className="mt-4 flex flex-wrap items-center gap-3"><span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">{t("enterprise.googleConnected")}{oauth.connectedEmail}</span><button className={secondaryButton} disabled={busy} onClick={() => void run(() => api("/api/orgs/vertex-oauth", { method: "DELETE", body: { orgId } }), t("enterprise.googleDisconnected"))}>{t("enterprise.disconnect")}</button></div> : <div className="mt-4"><a className={`${primaryButton} inline-block ${!oauth?.clientConfigured ? "pointer-events-none opacity-50" : ""}`} aria-disabled={!oauth?.clientConfigured} href={oauth?.clientConfigured ? `/auth/vertex/start?orgId=${encodeURIComponent(orgId)}` : undefined}>{t("enterprise.connectGoogle")}</a>{!oauth?.clientConfigured && <p className="mt-2 text-xs text-gray-500">{t("enterprise.loadJsonFirst")}</p>}</div>}
    </section>
    <section className={cardClass}>
      <h3 className="font-semibold">{t("enterprise.budgetTitle")}</h3>
      <p className="mt-1 text-sm text-gray-500">
        {t("enterprise.usageThisMonth")}${usage.toFixed(2)}
        {topUp > 0 && <span className="ml-2">（{t("enterprise.topUpBalance")}${topUp.toFixed(2)}）</span>}
      </p>
      <form method="POST" action="/hubwork/api/stripe/checkout" className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="plan" value="vertex-topup" />
        <input type="hidden" name="orgId" value={orgId} />
        <select name="units" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" defaultValue="1">
          {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{`+$${n * 10}`}</option>)}
        </select>
        <select name="currency" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" defaultValue="jpy">
          <option value="jpy">{t("enterprise.topUpJpy")}</option>
          <option value="usd">{t("enterprise.topUpUsd")}</option>
        </select>
        <button type="submit" className={secondaryButton} disabled={busy}>{t("enterprise.buyTopUp")}</button>
      </form>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-300">{t("enterprise.budgetAdvanced")}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t("enterprise.gcpProjectId")}><input className={inputClass} value={project} onChange={(e) => setProject(e.target.value)} placeholder="my-vertex-project" /></Field>
        <Field label={t("enterprise.vertexLocation")}><input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} list="vertex-locations" /><datalist id="vertex-locations"><option value="global" /><option value="asia-northeast1" /><option value="us-central1" /><option value="europe-west4" /></datalist></Field>
        <Field label={t("enterprise.orgMonthlyLimit")}><input className={inputClass} type="number" min="0" step="0.01" value={orgBudget} onChange={(e) => setOrgBudget(e.target.value)} placeholder={t("enterprise.unlimited")} /></Field>
        <Field label={t("enterprise.userMonthlyLimit")}><input className={inputClass} type="number" min="0" step="0.01" value={userBudget} onChange={(e) => setUserBudget(e.target.value)} placeholder={t("enterprise.unlimited")} /></Field>
        </div>
        <button className={`${primaryButton} mt-4`} disabled={busy || !location} onClick={() => void run(() => api("/api/orgs/ai-settings", { method: "POST", body: { orgId, vertexProjectId: project, vertexLocation: location, monthlyBudgetUsd: orgBudget || null, defaultUserMonthlyBudgetUsd: userBudget || null } }), t("enterprise.aiSettingsSaved"))}>{t("enterprise.saveAiSettings")}</button>
      </details>
    </section>
    {storage && (
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
        <p className="mt-3 text-xs leading-5 text-gray-500">
          {t("enterprise.storageIncluded").replace("{included}", String(storage.includedGb))}
        </p>
        <form method="POST" action="/hubwork/api/stripe/checkout" className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="plan" value="storage-addon" />
          <input type="hidden" name="orgId" value={orgId} />
          <select name="units" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" defaultValue="1">
            {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{`+${n * 500} GB`}</option>)}
          </select>
          <select name="currency" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" defaultValue="jpy">
            <option value="jpy">{t("enterprise.storageJpy")}</option>
            <option value="usd">{t("enterprise.storageUsd")}</option>
          </select>
          <button type="submit" className={secondaryButton} disabled={busy}>{t("enterprise.buyStorage")}</button>
        </form>
      </section>
    )}
  </div>;
}

function MembersSection({ orgId, members, ai, busy, run, isSuperOwner }: { orgId: string; members: OrgMemberItem[]; ai: AiPayload | null; busy: boolean; run: (task: () => Promise<unknown>, success: string) => Promise<void>; isSuperOwner: boolean }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [ownerEmail, setOwnerEmail] = useState("");
  return <div className="space-y-4">
    <section className={cardClass}>
      <h3 className="font-semibold">{t("enterprise.inviteMember")}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px_auto]"><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" /><select className={inputClass} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as OrgRole)}><option value="member">{t("enterprise.roleMember")}</option><option value="admin">{t("enterprise.roleAdmin")}</option></select><button className={primaryButton} disabled={busy || !email} onClick={() => void run(() => api("/api/members/invite", { method: "POST", body: { orgId, email, role: inviteRole } }), t("enterprise.inviteSent"))}>{t("enterprise.invite")}</button></div>
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

function ProjectsSection({ orgId, projects, projectId, setProjectId, projectMembers, canManage, busy, run, selectContext }: { orgId: string; projects: ProjectItem[]; projectId: string; setProjectId: (id: string) => void; projectMembers: ProjectMemberItem[]; canManage: boolean; busy: boolean; run: (task: () => Promise<unknown>, success: string) => Promise<void>; selectContext: (orgId: string, projectId: string | null) => Promise<void> }) {
  const { t } = useI18n();
  const [newId, setNewId] = useState(""); const [newName, setNewName] = useState("");
  const [email, setEmail] = useState(""); const [memberRole, setMemberRole] = useState<ProjectRole>("editor");
  const selected = projects.find((project) => project.id === projectId);
  return <div className="space-y-4">
    <section className={cardClass}>
      <h3 className="font-semibold">{t("enterprise.selectProject")}</h3>
      <div className="mt-3 flex gap-2">
        <select className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{t("enterprise.selectPlaceholder")}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button className={primaryButton} disabled={!projectId} onClick={() => void selectContext(orgId, projectId)}>{t("enterprise.useProject")}</button>
      </div>
    </section>
    {canManage && <details className={cardClass}><summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-gray-300">{t("enterprise.createProjectAdvanced")}</summary><div className="mt-4 grid gap-3 border-t border-gray-200 pt-4 dark:border-gray-800 sm:grid-cols-[1fr_1fr_auto]"><input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("enterprise.projectName")} /><input className={inputClass} value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="project-id" /><button className={primaryButton} disabled={busy || !newId || !newName} onClick={() => void run(() => api("/api/projects/create", { method: "POST", body: { orgId, projectId: newId, name: newName } }), t("enterprise.projectCreated"))}>{t("enterprise.create")}</button></div></details>}
    {selected && canManage && <section className={`${cardClass} overflow-x-auto`}><h3 className="font-semibold">{t("enterprise.membersOf").replace("{name}", selected.name)}</h3><div className="my-3 grid gap-2 sm:grid-cols-[1fr_150px_auto]"><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" /><select className={inputClass} value={memberRole} onChange={(e) => setMemberRole(e.target.value as ProjectRole)}><option value="viewer">{t("enterprise.roleViewer")}</option><option value="editor">{t("enterprise.roleEditor")}</option><option value="admin">{t("enterprise.roleAdmin")}</option></select><button className={primaryButton} disabled={busy || !email} onClick={() => void run(() => api("/api/members/add", { method: "POST", body: { orgId, projectId, email, role: memberRole } }), t("enterprise.projectMemberAdded"))}>{t("enterprise.add")}</button></div><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">{t("enterprise.colEmail")}</th><th className="p-2">{t("enterprise.colRole")}</th><th className="p-2">{t("enterprise.colExternal")}</th><th className="p-2">{t("enterprise.colActions")}</th></tr></thead><tbody>{projectMembers.map((member) => <tr key={member.uid} className="border-b"><td className="p-2">{member.email}</td><td className="p-2"><select className="rounded border px-2 py-1 dark:bg-gray-900" value={member.role} disabled={busy} onChange={(e) => void run(() => api("/api/members/update-role", { method: "POST", body: { orgId, projectId, uid: member.uid, role: e.target.value } }), t("enterprise.roleChanged"))}><option value="viewer">{t("enterprise.roleViewer")}</option><option value="editor">{t("enterprise.roleEditor")}</option><option value="admin">{t("enterprise.roleAdmin")}</option></select></td><td className="p-2">{member.isExternal ? t("enterprise.yes") : t("enterprise.no")}</td><td className="p-2"><button className="text-red-600" disabled={busy} onClick={() => confirm(t("enterprise.confirmRemoveProjectMember").replace("{email}", member.email)) && void run(() => api("/api/members/remove", { method: "POST", body: { orgId, projectId, uid: member.uid } }), t("enterprise.projectMemberRemoved"))}>{t("enterprise.delete")}</button></td></tr>)}</tbody></table></section>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
