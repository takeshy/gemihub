/**
 * JSON with object keys sorted, so the same content always has the same text. Configs parsed by a
 * schema and configs read back from storage hold equal values in different key orders; comparing or
 * hashing plain JSON.stringify would call them different and keep a resolved screen "in conflict".
 */
export const stableJson = (value: unknown) => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]]))
    : item);
