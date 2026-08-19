/**
 * ProjectSwitcher — compact dropdown listing shared projects in the given org.
 * Personal storage is shown separately in its persistent shelf.
 *
 * Pair with OrgSwitcher: switching the org typically clears the project,
 * and this component refetches whenever `orgId` changes.
 */

import { useEffect, useState } from "react";

interface ProjectListItem {
  id: string;
  orgId: string;
  name: string;
  gcsPrefix: string;
  allowedModels: string[];
  role: "admin" | "editor" | "viewer" | null;
}

export interface ProjectSwitcherProps {
  /** Org currently selected. null disables the switcher. */
  currentOrgId: string | null;
  /** Currently selected project id. */
  currentProjectId: string | null;
  onSelected?: (newProjectId: string | null) => void;
  className?: string;
  compact?: boolean;
}

export function ProjectSwitcher({
  currentOrgId,
  currentProjectId,
  onSelected,
  className,
  compact,
}: ProjectSwitcherProps) {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrgId) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    setProjects(null);
    void (async () => {
      try {
        const params = new URLSearchParams({ orgId: currentOrgId });
        const res = await fetch(`/api/projects/list?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { projects: ProjectListItem[] };
        if (!cancelled) {
          setProjects(data.projects);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed to load projects");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrgId]);

  async function pick(value: string) {
    const projectId = value === "" ? null : value;
    if (projectId === currentProjectId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      onSelected?.(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to switch project");
    } finally {
      setBusy(false);
    }
  }

  if (!currentOrgId) {
    return (
      <span className={className} style={{ color: "#999", fontSize: 12 }}>
        {compact ? "—" : "(no org)"}
      </span>
    );
  }
  if (projects === null) {
    return <span className={className} style={{ color: "#999" }}>{compact ? "…" : "Loading…"}</span>;
  }
  if (projects.length === 0) {
    return (
      <span className={className} style={{ color: "#999" }}>
        {compact ? <a href="/hubwork_admin">no projects</a> : <>No projects — <a href="/hubwork_admin">create one</a></>}
      </span>
    );
  }

  const selectedProjectId = projects.some((project) => project.id === currentProjectId)
    ? currentProjectId
    : null;

  const option = (project: ProjectListItem) => (
    <option key={project.id} value={project.id}>
      {project.name}
      {project.role ? ` [${project.role}]` : ""}
    </option>
  );

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {!compact && <label style={{ fontSize: 12, color: "#666" }}>Project:</label>}
      <select
        value={selectedProjectId ?? ""}
        onChange={(e) => void pick(e.target.value)}
        disabled={busy}
        className="h-7 min-w-[140px] rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 shadow-sm outline-none hover:bg-gray-50 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
      >
        {(!compact || !selectedProjectId) && <option value="">— select —</option>}
        {projects.length > 0 && (
          <optgroup label="共有プロジェクト">
            {projects.map(option)}
          </optgroup>
        )}
      </select>
      {error && (
        <span style={{ color: "#c00", fontSize: 12 }} title={error}>
          ⚠
        </span>
      )}
    </span>
  );
}
