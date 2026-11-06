/** Same per-shop identifier as the static storefront script. Storage failure keeps PV reporting. */
export function browserVisitorId(slug: string): string | undefined {
  try {
    const key = `gemihub:visitor:${slug}`;
    let saved: { id?: string; expires?: number } | null = null;
    try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* Replace corrupt data. */ }
    if (!saved?.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.id) || !(saved.expires! > Date.now())) {
      saved = { id: crypto.randomUUID(), expires: Date.now() + 90 * 86400000 };
      localStorage.setItem(key, JSON.stringify(saved));
    }
    return saved.id;
  } catch { return undefined; }
}
