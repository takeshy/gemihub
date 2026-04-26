export const WEBPAGE_BUILDER_SKILL_VERSION = "1.1.7";
export const WEBPAGE_BUILDER_SKILL_RELEASE_DATE = "2026-04-26";

export function compareSkillVersions(a: string | null | undefined, b: string | null | undefined): number {
  const normalize = (value: string | null | undefined): number[] => {
    const core = (value ?? "").trim().match(/\d+(?:\.\d+){0,2}/)?.[0] ?? "";
    return core.split(".").map((part) => parseInt(part, 10) || 0);
  };
  const left = normalize(a);
  const right = normalize(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function extractSkillVersion(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
