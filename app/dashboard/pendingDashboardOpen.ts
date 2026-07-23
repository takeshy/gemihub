/**
 * Lets a component outside DashboardHost (e.g. the chat panel's "New Dashboard"
 * button) ask DashboardHost to open a specific dashboard by path instead of
 * its default home dashboard.
 *
 * DashboardHost mounts fresh whenever the main viewer switches away from a
 * file back to the dashboard, so a plain window event can be missed if it
 * fires before DashboardHost mounts. `pendingPath` covers that race: it is
 * consumed on mount. The event covers the case where DashboardHost is
 * already mounted (chat's empty state can show while the dashboard is
 * already the active view).
 */

export const OPEN_DASHBOARD_EVENT = "gemihub-open-dashboard";
export const OPEN_HOME_DASHBOARD_EVENT = "gemihub-open-home-dashboard";

let pendingPath: string | null = null;

export function requestOpenDashboard(path: string): void {
  pendingPath = path;
  window.dispatchEvent(new CustomEvent(OPEN_DASHBOARD_EVENT, { detail: { path } }));
}

export function consumePendingDashboardOpen(): string | null {
  const path = pendingPath;
  pendingPath = null;
  return path;
}

export function requestOpenHomeDashboard(): void {
  window.dispatchEvent(new Event(OPEN_HOME_DASHBOARD_EVENT));
}
