/**
 * React context that exposes the loader's `EnterpriseSelectionView` to
 * any descendant — primarily the new useStorageSync / useStorageFile
 * hooks.
 *
 * Selection can be null (user hasn't picked a tenant + project yet); in
 * that case the hooks must no-op or surface a "no tenant" state. The
 * provider does NOT redirect on null — UI decides.
 */

import { createContext, useContext, useEffect, useLayoutEffect } from "react";
import type { EnterpriseSelectionView } from "~/types/enterprise";
import { setActiveTimelineAuthor } from "~/services/timeline-author";

interface EnterpriseContextValue {
  selection: EnterpriseSelectionView | null;
  currentOrgId: string | null;
  currentProjectId: string | null;
  /** Whether the user belongs to at least one organization (loader-computed). */
  hasOrganizations: boolean;
}

const EnterpriseContext = createContext<EnterpriseContextValue>({
  selection: null,
  currentOrgId: null,
  currentProjectId: null,
  hasOrganizations: false,
});

// On the client this must run before descendants' passive effects: the
// compatibility file APIs synchronously read the active selection while their
// dashboard loaders mount. useEffect would leave one commit where the previous
// project's localStorage value is still visible after a hard project switch.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface EnterpriseProviderProps {
  selection: EnterpriseSelectionView | null;
  currentOrgId?: string | null;
  currentProjectId?: string | null;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  hasOrganizations?: boolean;
  children: React.ReactNode;
}

export function EnterpriseProvider({
  selection,
  currentOrgId,
  currentProjectId,
  currentUserId,
  currentUserEmail,
  hasOrganizations,
  children,
}: EnterpriseProviderProps) {
  useIsomorphicLayoutEffect(() => {
    setActiveTimelineAuthor(currentUserId, currentUserEmail);
    if (typeof localStorage === "undefined") return;
    if (selection) {
      localStorage.setItem(
        "gemihub-active-tenant-project",
        JSON.stringify({ orgId: selection.orgId, projectId: selection.projectId }),
      );
    } else {
      localStorage.removeItem("gemihub-active-tenant-project");
    }
  }, [selection, currentUserId, currentUserEmail]);

  return (
    <EnterpriseContext.Provider
      value={{
        selection,
        currentOrgId: currentOrgId ?? selection?.orgId ?? null,
        currentProjectId: currentProjectId ?? selection?.projectId ?? null,
        hasOrganizations: hasOrganizations ?? selection !== null,
      }}
    >
      {children}
    </EnterpriseContext.Provider>
  );
}

export function useEnterpriseContext(): EnterpriseContextValue {
  return useContext(EnterpriseContext);
}

/** Returns the current selection, or null if none. Callers handle the null case. */
export function useEnterpriseSelection(): EnterpriseSelectionView | null {
  return useContext(EnterpriseContext).selection;
}

/**
 * Returns the current selection or throws if missing. Use in hooks/components
 * that genuinely cannot function without a tenant (e.g. useStorageSync).
 */
export function useRequireEnterpriseSelection(): EnterpriseSelectionView {
  const selection = useEnterpriseSelection();
  if (!selection) {
    throw new Error(
      "useRequireEnterpriseSelection: no project selected. Wrap usage in a guard.",
    );
  }
  return selection;
}

/**
 * Convenience: the mountKey for the selected project's storage-cache
 * namespace. Returns null when no project is selected.
 */
export function useProjectMountKey(): string | null {
  const selection = useEnterpriseSelection();
  if (!selection) return null;
  // Prefixed by orgId so different orgs never collide even if two tenants
  // somehow ended up with the same projectId.
  return `gcs:${selection.orgId}/${selection.projectId}`;
}
