/**
 * Compact workspace switcher for the IDE header. Visible only to users who
 * belong to at least one organization: lets them jump between My Drive (no
 * project selected) and the org's shared projects. Selecting posts
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
  const [projects, setProjects] = useState<ProjectItem[]>([]);
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

  const activeOrgId = currentOrgId ?? (orgs?.length === 1 ? orgs[0].id : null);

  useEffect(() => {
    if (!activeOrgId) { setProjects([]); return; }
    let cancelled = false;
    fetch(`/api/projects/list?${new URLSearchParams({ orgId: activeOrgId })}`)
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data: { projects?: ProjectItem[] }) => {
        if (!cancelled) setProjects(data.projects ?? []);
      })
      .catch(() => { if (!cancelled) setProjects([]); });
    return () => { cancelled = true; };
  }, [activeOrgId]);

  async function select(body: { orgId?: string | null; projectId: string | null }) {
    setBusy(true);
    try {
      const res = await fetch("/api/session/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      {orgs.length > 1 && (
        <select
          className={selectClass}
          value={activeOrgId ?? ""}
          disabled={busy}
          onChange={(e) => void select({ orgId: e.target.value || null, projectId: null })}
        >
          <option value="">{t("mount.myDrive")}</option>
          {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
      )}
      <select
        className={selectClass}
        value={currentProjectId ?? ""}
        disabled={busy || (!activeOrgId && projects.length === 0)}
        onChange={(e) => {
          const projectId = e.target.value || null;
          void select(projectId ? { orgId: activeOrgId, projectId } : { projectId: null });
        }}
      >
        <option value="">{t("mount.myDrive")}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    </span>
  );
}
