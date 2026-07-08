// Mirrors base-events.ts: fired (with detail.fileName = the .kanban path)
// after a .kanban definition file is written, so mounted kanban widgets
// referencing it re-read the definition.
export const DASHBOARD_KANBAN_FILE_UPDATED_EVENT = "dashboard-kanban-file-updated";
