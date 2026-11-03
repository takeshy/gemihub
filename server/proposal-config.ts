import { shopSchema, type ShopConfig } from "./domain.ts";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function merge(base: unknown, patch: unknown): unknown {
  if (!object(patch)) return patch;
  const result: Record<string, unknown> = object(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Invalid proposal field");
    result[key] = merge(result[key], value);
  }
  return result;
}
/** Materialize changed-field proposals before the same full validation and approval gates. */
export function proposalConfig(value: unknown, current: ShopConfig): ShopConfig {
  const complete = shopSchema.safeParse(value);
  if (complete.success) return complete.data;
  if (!object(value)) throw complete.error;
  return shopSchema.parse(merge(current, value));
}
