/**
 * OrgSwitcher — compact dropdown that lists every organization the
 * signed-in user is a member of, and lets them select one.
 *
 * Selecting an org POSTs `/api/session/select` and then triggers a page
 * reload via the `onSelected` callback (parent decides — `revalidator`
 * for an embedded use, `window.location.reload()` for a "switch and
 * everything must reset" use).
 *
 * Drop-in target for Phase 5d (IDE Header) and Phase 5b's admin page.
 */

import { useEffect, useState } from "react";

interface OrgListItem {
  id: string;
  name: string;
  role: "owner" | "admin" | "member" | null;
}

export interface OrgSwitcherProps {
  /** Currently selected org id (from session.currentOrgId). */
  currentOrgId: string | null;
  /** Called after a successful selection POST. Use to reload / revalidate. */
  onSelected?: (newOrgId: string | null) => void;
  /** Optional className for layout. */
  className?: string;
  /** Render compactly (no label). Default false. */
  compact?: boolean;
}

export function OrgSwitcher({
  currentOrgId,
  onSelected,
  className,
  compact,
}: OrgSwitcherProps) {
  const [orgs, setOrgs] = useState<OrgListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/orgs/list");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { organizations: OrgListItem[] };
        if (!cancelled) setOrgs(data.organizations);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed to load orgs");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(value: string) {
    const orgId = value === "" ? null : value;
    if (orgId === currentOrgId) return;
    setBusy(true);
    setError(null);
    try {
      // Switching org clears the project — they're scoped to a single org.
      const res = await fetch("/api/session/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, projectId: null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      onSelected?.(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to switch org");
    } finally {
      setBusy(false);
    }
  }

  if (orgs === null) {
    return <span className={className} style={{ color: "#999" }}>{compact ? "…" : "Loading orgs…"}</span>;
  }
  if (orgs.length === 0) {
    return (
      <span className={className} style={{ color: "#999" }}>
        {compact ? "no orgs" : <>No organizations — contact the service administrator</>}
      </span>
    );
  }
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {!compact && <label style={{ fontSize: 12, color: "#666" }}>Org:</label>}
      <select
        value={currentOrgId ?? ""}
        onChange={(e) => void pick(e.target.value)}
        disabled={busy}
        style={{ minWidth: 140 }}
      >
        <option value="">— select —</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && (
        <span style={{ color: "#c00", fontSize: 12 }} title={error}>
          ⚠
        </span>
      )}
    </span>
  );
}
