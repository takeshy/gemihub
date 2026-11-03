export function articleKinds(config?: { appearance?: { articles?: { blogs: boolean; announcements: boolean } } } | null) {
  return (["blogs", "announcements"] as const).filter(kind => config?.appearance?.articles?.[kind] ?? true);
}
