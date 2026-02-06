// Icon sizes that scale with the root font-size setting (14/16/18/20px).
// Using rem ensures icons grow/shrink with the user's fontSize preference.
export const ICON = {
  SM: "0.875rem", // ~14px at 16px base
  MD: "1rem", // ~16px at 16px base
  LG: "1.125rem", // ~18px at 16px base
  XL: "1.25rem", // ~20px at 16px base
} as const;
