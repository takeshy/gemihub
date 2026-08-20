/**
 * Compact workspace switcher for the IDE header. Visible only to users who
 * belong to at least one organization: lets them jump between My Drive and
 * organizations. Each organization uses its compatibility default project
 * internally; projects are not exposed as a user-facing workspace level.
 * /api/session/select and reloads so every loader re-resolves the mount.
 */

import { useEffect, useState } from "react";
import { useEnterpriseContext } from "~/contexts/EnterpriseContext";
import { useI18n } from "~/i18n/context";

interface OrgItem { id: string; name: string }
interface ProjectItem { id: string; name: string }

const selectClass =
  "h-6 max-w-[140px] truncate rounded border border-gray-300 bg-white px-1.5 text-xs text-gray-800 outline-none hover:bg-gray-50 focus:border-blue-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800";

export function MountSwitcher() {
  const { currentOrgId, currentProjectId, hasOrganizations } = useEnterpriseContext();
  const { t } = useI18n();
  const [orgs, setOrgs] = useState<OrgItem[] | null>(null);
  const [busy, setBusy] = useState(false);

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
    try {
      let projectId: string | null = null;
      if (orgId) {
        const projectsResponse = await fetch(`/api/projects/list?${new URLSearchParams({ orgId })}`);
        if (!projectsResponse.ok) throw new Error(`HTTP ${projectsResponse.status}`);
        const data = await projectsResponse.json() as { projects?: ProjectItem[] };
        projectId = data.projects?.find((project) => project.id === "default")?.id
          ?? (data.projects?.length === 1 ? data.projects[0].id : null);
        if (!projectId) throw new Error("Organization storage is not ready");
      }
      const res = await fetch("/api/session/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, projectId }),
      });
      if (res.ok) {
        // Drop `?file=` — ids do not carry across mounts (a Drive file id is
        // not a project path), so keeping it would just 404 after the reload.
        const url = new URL(window.location.href);
        url.searchParams.delete("file");
        window.location.href = url.toString();
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }

  // Ordinary users (no organizations) never see the switcher; the loader
  // flag also keeps self-hosted (no Firestore) installs from ever fetching.
  if (!hasOrganizations || !orgs || orgs.length === 0) return null;

  return (
    <span className="hidden items-center gap-1 sm:inline-flex" title={t("mount.switcherTitle")}>
      <select
        className={selectClass}
        value={currentProjectId ? currentOrgId ?? "" : ""}
        disabled={busy}
        onChange={(e) => void selectOrganization(e.target.value || null)}
      >
        <option value="">{t("mount.myDrive")}</option>
        {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select>
    </span>
  );
}
