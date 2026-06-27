import { DASHBOARD_FOLDER } from "../types";

export const WORKFLOW_CACHE_PREFIX = `${DASHBOARD_FOLDER}/Data/`;

export function workflowCacheFilePath(dashboardCacheKey: string): string {
  return `${WORKFLOW_CACHE_PREFIX}${encodeURIComponent(dashboardCacheKey)}.json`;
}
