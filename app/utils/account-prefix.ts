/**
 * Account prefix utilities for Hubwork routing.
 * With custom domains, the prefix is always empty (no path-based account routing).
 */
export function getAccountPrefix(): string {
  return "";
}

export function prefixUrl(path: string): string {
  return path;
}
