let clearIndexCache: (() => void) | null = null;

/** Register the route-owned cache clearer without importing the route module. */
export function registerIndexCacheInvalidator(invalidator: () => void): void {
  clearIndexCache = invalidator;
}

/** Notify the index route that settings affecting its loader data changed. */
export function invalidateIndexCache(): void {
  clearIndexCache?.();
}
