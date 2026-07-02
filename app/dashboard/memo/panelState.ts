// Global memo-panel toggle state for IDE viewers, remembered in localStorage
// (dashboards persist the same state per-widget in the .dashboard config
// instead). One value for the whole browser: turn it on once and every
// document you open shows its memo panel.

export interface MemoPanelState {
  open: boolean;
  collapsed: boolean;
}

const STORAGE_KEY = "gemihub-memoPanel"; // "open" | "collapsed" | "closed"

export function getStoredMemoPanelState(): MemoPanelState {
  if (typeof window === "undefined") return { open: false, collapsed: false };
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === "open") return { open: true, collapsed: false };
  if (value === "collapsed") return { open: true, collapsed: true };
  return { open: false, collapsed: false };
}

export function setStoredMemoPanelState(state: MemoPanelState): void {
  if (typeof window === "undefined") return;
  const value = state.open ? (state.collapsed ? "collapsed" : "open") : "closed";
  localStorage.setItem(STORAGE_KEY, value);
}
