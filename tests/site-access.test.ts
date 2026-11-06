import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample } from "../server/domain.ts";
import { dateIn } from "../shared/region.ts";
import { ShopLogs, pageViewAnonymousLimit, pageViewShopLimit } from "../server/shop-logs.ts";
import { postKey, type Post } from "../server/post-domain.ts";
import type { ArticleAccessResult, SiteTrafficResult } from "../shared/article-access.ts";

process.env.DEMO_MODE = "true";

function article(shopId: string, category: "blogs" | "announcements"): Post {
  const content = { category, title: `${category} article`, date: "2026-11-06", slug: "hello", excerpt: "Hello", body: "<p>Hello readers</p>" }, at = new Date().toISOString();
  return { id: randomUUID(), shopId, draft: content, published: content, publishedAt: at, version: 1, createdAt: at, updatedAt: at, updatedBy: "owner@example.com" };
}

test("browser counts deduplicate visits within a local day across pages and retain separate article audiences", async () => {
  const store = new Store(":memory:"), logs = new ShopLogs(store);
  const browser = randomUUID(), other = randomUUID();
  logs.pageView("shop", "home", "2026-11-05", browser);
  logs.pageView("shop", "article", "2026-11-05", browser, "post");
  logs.pageView("shop", "article", "2026-11-05", browser, "post");
  logs.pageView("shop", "article", "2026-11-05", other, "post");
  logs.pageView("shop", "reserve", "2026-11-05"); // Storage disabled: PV without a made-up visitor.
  logs.pageView("shop", "home", "2026-11-06", browser);
  logs.pageView("foreign", "home", "2026-11-05", browser);
  await logs.drain();
  assert.deepEqual(await store.countDailyTraffic("shop", "2026-11-05"), { date: "2026-11-05", views: 5, uniqueBrowsers: 2 });
  assert.deepEqual(await store.countDailyTraffic("shop", "2026-11-06"), { date: "2026-11-06", views: 1, uniqueBrowsers: 1 });
  const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 1000).toISOString();
  assert.equal(await store.countPostViews("shop", "post", from, to), 3);
  assert.equal(await store.countPostVisitors("shop", "post", from, to), 2);
  assert.ok(!JSON.stringify(await store.queryShopLogs("shop", from, to, 100)).includes(browser), "raw browser IDs never persist in event logs");
});

test("anonymous page views reach daily and article stats, while operators, drafts, disabled pages and foreign tenants are excluded", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  const blog = article(shop.id, "blogs"), news = article(shop.id, "announcements"), draft = article(shop.id, "blogs"); draft.published = null; draft.draft.slug = "draft";
  for (const post of [blog, news, draft]) await store.put("post", post.id, post);
  const otherShop = await store.createShop("other@example.com"); otherShop.published = structuredClone(sample); otherShop.publication = "public"; await store.saveShop(otherShop);
  const server = createApp(store); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  const ownerCookie = "gemihub_session=access-owner", staffCookie = "gemihub_session=access-staff";
  await store.put("session", digest("access-owner"), { user: { role: "owner", email: shop.owner, shopId: shop.id, name: "Owner" }, expires: Date.now() + 600000 });
  await store.put("session", digest("access-staff"), { user: { role: "customer", email: "staff@example.com", shopId: shop.id, name: "Staff" }, expires: Date.now() + 600000 });
  await store.put("member", `${shop.id}:staff@example.com`, { shopId: shop.id, email: "staff@example.com", accepted: true });
  const post = (slug: string, data: unknown, cookie = "") => fetch(`${origin}/api/public/${slug}/page-views`, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const browser = randomUUID(), second = randomUUID();
  const blogVisit = { page: "article", category: "blogs", key: postKey(blog.published!), visitorId: browser };
  for (const event of [{ page: "home", visitorId: browser }, blogVisit, blogVisit, { ...blogVisit, visitorId: second }, { page: "article", category: "blogs", key: blogVisit.key }, { page: "article", category: "announcements", key: postKey(news.published!), visitorId: browser }]) assert.equal((await post(shop.slug, event)).status, 200);
  for (const cookie of [ownerCookie, staffCookie]) assert.equal((await post(shop.slug, blogVisit, cookie)).status, 200);
  assert.equal((await post(otherShop.slug, blogVisit)).status, 404);
  assert.equal((await post(shop.slug, { ...blogVisit, key: postKey(draft.draft) })).status, 404);
  assert.equal((await post(shop.slug, { ...blogVisit, shopId: otherShop.id })).status, 400);
  assert.equal((await post(shop.slug, { page: "custom", slug: "missing" })).status, 404);
  assert.equal((await fetch(`${origin}/api/shops/${shop.id}/access`)).status, 403);
  assert.equal((await fetch(`${origin}/api/shops/${otherShop.id}/access`, { headers: { Cookie: ownerCookie } })).status, 403);
  const get = (path: string) => fetch(`${origin}/api/shops/${shop.id}/${path}`, { headers: { Cookie: ownerCookie } });
  const articles = await (await get("posts/access?days=7")).json() as ArticleAccessResult;
  assert.equal(articles.total, 5); assert.deepEqual(articles.byCategory, { blogs: 4, announcements: 1 });
  assert.equal(articles.rows.find(row => row.postId === blog.id)?.uniqueBrowsers, 2);
  const traffic = await (await get("access?days=7")).json() as SiteTrafficResult;
  assert.equal(traffic.rows.length, 7); assert.equal(traffic.totalViews, 6);
  assert.deepEqual(traffic.rows[0], { date: dateIn(new Date(), traffic.timeZone), views: 6, uniqueBrowsers: 2 });
  assert.equal((await get("access?days=5000")).status, 400);
  const anonymous = await (await fetch(`${origin}/s/${shop.slug}/blogs/${blogVisit.key}`)).text();
  assert.ok(anonymous.includes(`data-shop-slug="${shop.slug}"`));
  assert.ok(anonymous.includes("/storefront-login.js"));
  const noJs = await (await get("posts/access?days=7")).json() as ArticleAccessResult;
  assert.equal(noJs.total, 5, "fetching HTML alone does not count an extra browser view");
  const records = store.records.bind(store);
  let articleReads = 0;
  t.mock.method(store, "records", async (...args: Parameters<typeof store.records>) => { if (args[0] === "post") articleReads++; return records(...args); });
  for (let i = 0; i < 70; i++) assert.equal((await post(shop.slug, { ...blogVisit, visitorId: randomUUID() })).status, 200, "independent browsers sharing one proxy IP have independent rate limits");
  assert.equal(articleReads, 0, "view validation uses the selected release manifest without reloading all posts");
  const staffActivity = await fetch(`${origin}/api/public/${shop.slug}/activity`, { method: "POST", headers: { Origin: origin, Cookie: staffCookie, "Content-Type": "application/json" }, body: JSON.stringify({ event: "reserve_view" }) });
  assert.equal(staffActivity.status, 200);
  assert.equal((await staffActivity.json() as { ignored: boolean }).ignored, true);
  const logs = await store.queryShopLogs(shop.id, new Date(Date.now() - 60000).toISOString(), new Date().toISOString(), 5000);
  assert.equal(logs.filter(row => row.kind === "error" && row.status === 429).length, 0);
  assert.equal(logs.filter(row => row.kind === "error" && row.operation.includes("activity")).length, 0);
  shop.published.appearance = { ...shop.published.appearance!, articles: { blogs: false, announcements: true } };
  await store.saveShop(shop);
  assert.equal((await post(shop.slug, blogVisit)).status, 404);
  assert.equal((await post(shop.slug, { page: "blogs" })).status, 404);
  const homeViews = async () => { await new Promise(resolve => setTimeout(resolve, 50)); return (await store.queryShopLogs(shop.id, new Date(Date.now() - 3600000).toISOString(), new Date().toISOString(), 5000, undefined, { kind: "page_view" })).filter(row => row.operation === "contact").length; };
  for (let i = 0; i < pageViewAnonymousLimit + 5; i++) assert.equal((await post(shop.slug, { page: "contact" })).status, 200, "an uncounted view is not an error");
  assert.ok(await homeViews() <= pageViewAnonymousLimit, "views without a browser ID share one budget");
  for (let i = 0; i < pageViewShopLimit; i++) await post(shop.slug, { page: "contact", visitorId: randomUUID() });
  assert.ok(await homeViews() < pageViewShopLimit, "forged browser IDs cannot exceed the shop's budget");
  const ignored = await post(shop.slug, { page: "contact", visitorId: randomUUID() });
  assert.equal(ignored.status, 200); assert.equal((await ignored.json() as { ignored: boolean }).ignored, true);
});
