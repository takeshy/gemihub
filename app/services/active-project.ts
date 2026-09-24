/**
 * The project mount selected in THIS browser tab.
 *
 * Non-React code (the IndexedDB cache dispatcher, file APIs) needs the active
 * selection synchronously. localStorage alone cannot carry it: it is shared by
 * every tab, so a second tab switching projects would silently redirect this
 * tab's cache reads/writes into the other project. EnterpriseProvider records
 * the selection here in a layout effect; module state is per tab.
 *
 * localStorage is still written as a fallback for code that runs before the
 * provider's first commit.
 */

export interface ActiveProjectSelection {
  orgId: string;
  projectId: string;
}

const STORAGE_KEY = "gemihub-active-tenant-project";

/** undefined = not recorded yet in this tab; null = Drive (no project). */
let tabSelection: ActiveProjectSelection | null | undefined;

export function setActiveProjectSelection(selection: ActiveProjectSelection | null): void {
  tabSelection = selection ? { orgId: selection.orgId, projectId: selection.projectId } : null;
  if (typeof localStorage === "undefined") return;
  try {
    if (tabSelection) localStorage.setItem(STORAGE_KEY, JSON.stringify(tabSelection));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked — the per-tab value above is authoritative anyway.
  }
}

export function getActiveProjectSelection(): ActiveProjectSelection | null {
  if (tabSelection !== undefined) return tabSelection;
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { orgId?: string; projectId?: string };
    return parsed.orgId && parsed.projectId
      ? { orgId: parsed.orgId, projectId: parsed.projectId }
      : null;
  } catch {
    return null;
  }
}
