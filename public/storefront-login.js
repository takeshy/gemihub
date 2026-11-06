// Older email links used the public home. Keep their fragment secret while opening the login screen.
if (new URLSearchParams(location.hash.slice(1)).has("email-login")) {
  const url = new URL(location.href);
  url.pathname = document.getElementById("root").dataset.shopBase || "/";
  url.searchParams.set("pane", "mine");
  location.replace(url.href);
}

// Count anonymous and cached article displays. A shop-specific random browser ID approximates
// unique readers. The server validates the article and excludes signed-in operators.
(() => {
  if (!/^https?:$/.test(location.protocol) || new URLSearchParams(location.hash.slice(1)).has("email-login")) return;
  const root = document.getElementById("root");
  if (root?.dataset.page !== "static-storefront") return;
  const base = root.dataset.shopBase || "";
  const slug = root.dataset.shopSlug || base.match(/^\/s\/([^/]+)$/)?.[1];
  const path = base && (location.pathname === base || location.pathname.startsWith(base + "/")) ? location.pathname.slice(base.length) : location.pathname;
  const article = path.match(/^\/(blogs|announcements)\/([a-z0-9-]+)\/?$/);
  const archive = path.match(/^\/(blogs|announcements)\/?$/);
  const custom = path.match(/^\/pages\/([a-z0-9-]+)\/?$/);
  const page = article ? { page: "article", category: article[1], key: article[2] } : archive ? { page: archive[1] } : custom ? { page: "custom", slug: custom[1] } : /^\/?$/.test(path) ? { page: "home" } : undefined;
  if (!slug || !page) return;
  let visitorId;
  try {
    const storageKey = `gemihub:visitor:${slug}`;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { /* Replace corrupt local data. */ }
    if (!saved || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.id) || !(saved.expires > Date.now())) {
      saved = { id: crypto.randomUUID(), expires: Date.now() + 90 * 86400000 };
      localStorage.setItem(storageKey, JSON.stringify(saved));
    }
    visitorId = saved.id;
  } catch { /* Storage disabled: still count the view, without inventing a unique reader. */ }
  let reported = false;
  const report = () => {
    if (reported || document.visibilityState !== "visible") return;
    reported = true;
    void fetch(`/api/public/${encodeURIComponent(slug)}/page-views`, {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...page, ...(visitorId ? { visitorId } : {}) }),
    }).catch(() => {});
  };
  report();
  document.addEventListener("visibilitychange", report);
  window.addEventListener("pageshow", event => { if (event.persisted) { reported = false; report(); } });
})();
