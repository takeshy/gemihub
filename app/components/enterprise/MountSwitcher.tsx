/**
 * Compact workspace switcher for the IDE header. Visible only to users who
 * belong to at least one organization: lets them jump between My Drive and
 * organizations. Each organization uses its compatibility default project
 * internally; projects are not exposed as a user-facing workspace level.
 * Selecting posts /api/session/select and reloads so every loader re-resolves
 * the mount. Shown on mobile too — it is the only way back to My Drive, which
 * some settings (e.g. the Hubwork billing tab) need.
 */

import { useEffect, useState } from "react";
import { useEnterpriseContext } from "~/contexts/EnterpriseContext";
import { useI18n } from "~/i18n/context";

interface OrgItem { id: string; name: string }
interface ProjectItem { id: string; name: string }

const selectClass =
  "h-6 max-w-[104px] truncate rounded sm:max-w-[140px] border border-gray-300 bg-white px-1.5 text-xs text-gray-800 outline-none hover:bg-gray-50 focus:border-blue-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800";

export function MountSwitcher() {
  const { currentOrgId, currentProjectId, hasOrganizations } = useEnterpriseContext();
  const { t } = useI18n();
  const [orgs, setOrgs] = useState<OrgItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasOrganizations) return;
    let cancelled = false;
    fetch("/api/orgs/list")
      .then((res) => (res.ok ? res.json() : { organizations: [] }))
      .then((data: { organizations?: OrgItem[] }) => {
        if (!cancelled) setOrgs(data.organizations ?? []);
      })
      .catch(() => { if (!cancelled) setOrgs([]); });
    return () => { cancelled = true; };
  }, [hasOrganizations]);

  async function selectOrganization(orgId: string | null) {
    setBusy(true);
    setError(null);
    try {
      // Clearing the project is what selects My Drive. The org id stays in the
      // session on purpose: unsetting it makes resolveEnterpriseContext report
      // "no-org", which is the exact condition that makes the _index loader
      // auto-select the single-org default project again — the user would be
      // bounced straight back into the organization. Leaving it set yields
      // "no-project", which the loader skips.
      let body: { orgId?: string | null; projectId: string | null } = { projectId: null };
      if (orgId) {
        const projectsResponse = await fetch(`/api/projects/list?${new URLSearchParams({ orgId })}`);
        if (!projectsResponse.ok) throw new Error(`HTTP ${projectsResponse.status}`);
        const data = await projectsResponse.json() as { projects?: ProjectItem[] };
        const projectId = data.projects?.find((project) => project.id === "default")?.id
          ?? (data.projects?.length === 1 ? data.projects[0].id : null);
        if (!projectId) throw new Error("Organization storage is not ready");
        body = { orgId, projectId };
      }
      const res = await fetch("/api/session/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Drop `?file=` — ids do not carry across mounts (a Drive file id is
      // not a project path), so keeping it would just 404 after the reload.
      const url = new URL(window.location.href);
      url.searchParams.delete("file");
      window.location.href = url.toString();
    } catch (switchError) {
      // Surface the failure instead of letting the <select> snap back with no
      // explanation — an organization whose default project is missing would
      // otherwise look like a dropdown that simply does nothing.
      setError(switchError instanceof Error ? switchError.message : String(switchError));
      setBusy(false);
    }
  }

  // Ordinary users (no organizations) never see the switcher; the loader
  // flag also keeps self-hosted (no Firestore) installs from ever fetching.
  if (!hasOrganizations || !orgs || orgs.length === 0) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={t("mount.switcherTitle")}>
      <select
        className={selectClass}
        value={currentProjectId ? currentOrgId ?? "" : ""}
        disabled={busy}
        onChange={(e) => void selectOrganization(e.target.value || null)}
      >
        <option value="">{t("mount.myDrive")}</option>
        {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select>
      {error && (
        <span className="max-w-[120px] truncate text-xs text-red-600 dark:text-red-400" title={error}>
          {t("mount.switchFailed")}
        </span>
      )}
    </span>
  );
}
