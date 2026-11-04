import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample, shopSchema } from "../server/domain.ts";
import { liveValue } from "../server/live-settings.ts";
import { buildStorefront, storefrontAssetObject, storefrontFile, storefrontObject, storefrontRenderer } from "../server/storefront-build.tsx";
import type { StorefrontFiles } from "../server/storefront-files.ts";
import type { Post } from "../server/post-domain.ts";
import { imageUses, managedImageIds } from "../server/image-references.ts";

process.env.DEMO_MODE = "true";

test("static builds freeze the design, managed images and translated navigation without app code or private data", () => {
  const config = shopSchema.parse(structuredClone(sample)), imageId = "a".repeat(64);
  config.name = "Moon <Atelier>";
  config.notificationEmail = "PRIVATE_INBOX@example.com";
  config.header.imageId = imageId;
  config.screens = { about: { html: '<section><h2>CUSTOM_ABOUT</h2><slot name="menus"></slot></section>', css: "h2 { padding: 23px; }" } };
  config.pages = [{ id: "story", slug: "story", title: "Story", navigationLabel: "Story", body: `<p>STORY_BODY</p><img data-image-id="${imageId}" alt="Story photo">`, css: "", imageUrl: "", layout: "standard" }];
  const screenImage = "b".repeat(64);
  config.screens.about!.html += `<img data-image-id="${screenImage}" alt="Shop photo">`;
  assert.ok(managedImageIds(config).includes(screenImage));
  assert.ok(imageUses(config, screenImage).length, "images frozen into screen designs remain protected from archival");
  assert.ok(imageUses(config, imageId).some(use => use.includes("Story")), "custom-page body images are public references too");
  const shop = { id: "shop", slug: "moon", owner: "PRIVATE_OWNER@example.com", published: config, draft: null, revision: 1, history: [], publication: "public" as const };
  const shell = { html: '<html><head><title>App</title></head><body><div id="root"></div></body></html>', css: ".app { color: red; }" };
  const images = { [imageId]: { mimeType: "image/png" as const, data: "aGVsbG8=" } };
  const build = buildStorefront(shop, [], "https://app.example.com", shell, images), files = build.pages;
  const ja = files[storefrontFile("", false, "ja")], en = files[storefrontFile("", true, "en")];
  // CSS and images are shared, content-addressed files referred to by URL, not embedded in every page.
  const imageName = `${createHash("sha256").update("hello").digest("hex")}.png`, cssName = `${createHash("sha256").update(shell.css).digest("hex")}.css`;
  assert.deepEqual(Object.keys(build.assets).sort(), [cssName, imageName].sort());
  assert.doesNotMatch(ja + en, /data:image|<style>\.app/);
  assert.ok(ja.includes(`<link rel="stylesheet" href="/s/moon/_assets/${cssName}">`) && en.includes(`<link rel="stylesheet" href="/_assets/${cssName}">`));
  assert.ok(ja.includes(`<meta property="og:image" content="https://app.example.com/s/moon/_assets/${imageName}">`), "a managed header image is the link preview image");
  // Each language is its own indexable URL.
  assert.ok(ja.includes('<link rel="canonical" href="https://app.example.com/s/moon">') && en.includes('<link rel="canonical" href="https://app.example.com/s/moon?lang=en">'));
  assert.ok(ja.includes('<link rel="alternate" hreflang="en" href="https://app.example.com/s/moon?lang=en">'));
  assert.match(ja, /CUSTOM_ABOUT/);
  assert.match(ja, /padding: 23px/);
  assert.ok(ja.includes(`/s/moon/_assets/${imageName}`));
  assert.doesNotMatch(ja, /PRIVATE_|type="module"|gemihub-storefront-state/);
  assert.match(ja, /href="\/s\/moon\?pane=reserve&amp;lang=ja"/);
  assert.match(en, /href="\/\?pane=reserve&amp;lang=en"/);
  assert.match(en, /Book now/);
  assert.ok(new RegExp(`STORY_BODY.*/_assets/${imageName}`, "s").test(files[storefrontFile("pages/story", true, "en")]));
  config.screens.about!.html = "<section>NO_MENU_SLOT</section>";
  const withoutSlots = buildStorefront(shop, [], "https://app.example.com", shell).pages[storefrontFile("", false, "ja")];
  assert.doesNotMatch(withoutSlots, new RegExp(config.menus[0].name));
});

test("publication uploads before cutover, reads never rebuild, and failed updates preserve the previous release", async t => {
  const store = new Store(":memory:"), objects = new Map<string, Buffer>();
  let writes = 0, failAfter = Infinity;
  let hold: Promise<void> | undefined, started: (() => void) | undefined;
  const files: StorefrontFiles = {
    async write(path, body) { writes++; started?.(); await hold; if (writes >= failAfter) throw new Error("fixture bucket unavailable"); objects.set(path, Buffer.from(body)); },
    async read(path) { return objects.get(path); },
    async remove(path) { objects.delete(path); },
  };
  const server = createApp(store, undefined, undefined, undefined, undefined, undefined, undefined, files);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const shop = await store.createShop("owner@example.com");
  shop.published = shopSchema.parse(structuredClone(sample)); shop.publication = "public";
  shop.published.description = "PREVIOUS_DESCRIPTION";
  shop.published.notificationEmail = "private-inbox@example.com";
  shop.published.pages = [{ id: "story", slug: "story", title: "Story", navigationLabel: "Story", body: "<p>STORY_BODY</p>", imageUrl: "", layout: "standard" }];
  await store.saveShop(shop);
  await store.put("session", digest("owner"), { user: { email: shop.owner, role: "owner", name: "Owner", shopId: shop.id }, expires: Date.now() + 600000 });
  const top = `/s/${shop.slug}`, api = `/api/shops/${shop.id}`;
  const get = async (path: string, cookie = "", headers = {}) => fetch(origin + path, { headers: { Cookie: cookie, ...headers }, redirect: "manual" });
  const post = (path: string, body: unknown) => fetch(origin + path, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const first = await get(top), original = await first.text();
  assert.equal(first.status, 200);
  assert.match(original, /PREVIOUS_DESCRIPTION/);
  assert.match(original, /data-page="static-storefront"/);
  assert.doesNotMatch(original, /private-inbox|type="module"|\/assets\/[^" ]+\.js/);
  const release = (await store.shop(shop.id))!.storefrontRelease!;
  assert.equal(release.renderer, storefrontRenderer);
  const css = original.match(/href="(\/s\/[^"]+\/_assets\/[a-f0-9]{64}\.css)"/)![1];
  const stylesheet = await get(css);
  assert.equal(stylesheet.status, 200);
  assert.equal(stylesheet.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.match(stylesheet.headers.get("content-type")!, /^text\/css/);
  assert.equal((await get(`/s/${shop.slug}/_assets/${"d".repeat(64)}.css`)).status, 404, "only assets of the shop's releases are served");
  const before = writes;
  assert.equal((await get(top)).status, 200);
  assert.equal(writes, before, "ordinary reads never rebuild or upload");
  assert.equal((await get(top, "", { "If-None-Match": first.headers.get("etag")! })).status, 304);
  assert.equal((await get(top + "?pane=reserve")).headers.get("cache-control"), "private, no-store");
  assert.match(await (await get(top + "?pane=reserve")).text(), /<div id="root"><\/div>/);
  assert.equal((await get(top + "/pages/missing")).status, 404);
  assert.match(await (await get(top + "/pages/story?lang=en")).text(), /STORY_BODY/);
  assert.match(await (await get(top + "/sitemap.xml")).text(), /pages\/story/);

  const value = { ...liveValue(shop.published, "basic") as object, description: "NEXT_DESCRIPTION" };
  let releaseHold!: () => void;
  hold = new Promise<void>(resolve => { releaseHold = resolve; });
  const uploading = new Promise<void>(resolve => { started = resolve; });
  failAfter = writes + 3;
  const failed = post(api + "/live-settings/basic", { value, requestId: randomUUID() });
  await uploading;
  const during = await Promise.race([get(top), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("static page waits for the publication lock")), 1500))]);
  assert.match(await during.text(), /PREVIOUS_DESCRIPTION/, "the old release stays readable during uploads");
  releaseHold(); hold = undefined; started = undefined;
  assert.equal((await failed).status, 503);
  assert.deepEqual((await store.shop(shop.id))!.storefrontRelease, release);
  assert.match(await (await get(top)).text(), /PREVIOUS_DESCRIPTION/);
  failAfter = Infinity;
  assert.equal((await post(api + "/live-settings/basic", { value, requestId: randomUUID() })).status, 200);
  assert.match(await (await get(top)).text(), /NEXT_DESCRIPTION/);
  assert.notEqual((await store.shop(shop.id))!.storefrontRelease!.id, release.id);
  assert.ok(objects.has(storefrontObject(shop.id, release, storefrontFile("", false, "ja"))), "old objects survive cutover");
  // The current release and the two before it are kept; older pages are deleted, shared assets stay while used.
  for (const description of ["THIRD_DESCRIPTION", "FOURTH_DESCRIPTION"]) assert.equal((await post(api + "/live-settings/basic", { value: { ...value, description }, requestId: randomUUID() })).status, 200);
  assert.equal(objects.has(storefrontObject(shop.id, release, storefrontFile("", false, "ja"))), false, "releases beyond retention are removed");
  assert.ok(objects.has(storefrontAssetObject(shop.id, css.split("/").pop()!)), "a stylesheet kept releases use is not removed");
  assert.equal((await get(css)).status, 200);

  // Publishing and withdrawing articles update the generated home, archive and article together.
  const content = { category: "blogs", title: "Winter story", date: "2030-01-02", slug: "winter", excerpt: "Winter excerpt", body: "WINTER_BODY" };
  const articleResponse = await post(api + "/posts", { content, publish: true, requestId: randomUUID() });
  assert.equal(articleResponse.status, 200);
  const article = await articleResponse.json() as Post;
  assert.match(await (await get(top + "/blogs/2030-01-02-winter")).text(), /WINTER_BODY/);
  assert.match(await (await get(top)).text(), /Winter story/);
  assert.equal((await post(api + `/posts/${article.id}/unpublish`, { version: article.version })).status, 200);
  assert.equal((await get(top + "/blogs/2030-01-02-winter")).status, 404);
  assert.doesNotMatch(await (await get(top + "/blogs")).text(), /Winter story/);

  // Host aliases read the same release with the correct relative links and canonical URL.
  const current = (await store.shop(shop.id))!;
  current.domain = "static.example.test"; current.domainVerified = true; delete current.storefrontRelease;
  await store.saveShop(current);
  const hosted = await new Promise<string>((resolve, reject) => {
    httpRequest(origin + "/pages/story", { headers: { Host: current.domain } }, response => {
      let body = ""; response.on("data", chunk => { body += chunk; }); response.on("end", () => resolve(body));
    }).on("error", reject).end();
  });
  assert.match(hosted, /href="https:\/\/static.example.test\/pages\/story"/);
  assert.match(hosted, /href="\/\?pane=reserve&amp;lang=ja"/);
  current.publication = "provisional"; delete current.storefrontRelease; await store.saveShop(current);
  assert.equal((await get(top)).status, 302);
  assert.equal((await get(top, "gemihub_session=owner")).headers.get("cache-control"), "private, no-store");
  assert.match(await (await get(top, "gemihub_session=owner")).text(), /noindex, nofollow/);
  assert.equal((await get(top + "/sitemap.xml")).status, 404);

  // A release from an older generator is still served while the background loop rebuilds it.
  current.publication = "public"; await store.saveShop(current);
  assert.equal((await get(top)).status, 200);
  const stale = (await store.shop(shop.id))!; stale.storefrontRelease = { ...stale.storefrontRelease!, renderer: storefrontRenderer - 1 }; await store.saveShop(stale);
  const staleWrites = writes;
  assert.equal((await get(top)).status, 200);
  assert.equal(writes, staleWrites, "reads never rebuild an existing release");
  // An image that cannot be read is left out of the page instead of blocking publication.
  stale.published!.header.imageId = "c".repeat(64); delete stale.storefrontRelease; await store.saveShop(stale);
  const withoutImage = await get(top);
  assert.equal(withoutImage.status, 200);
  assert.doesNotMatch(await withoutImage.text(), /og:image/);
  // A failed first conversion backs off instead of rebuilding on every request.
  delete stale.storefrontRelease; await store.saveShop(stale);
  failAfter = writes + 1;
  assert.equal((await get(top)).status, 503);
  const failedWrites = writes, retry = await get(top);
  assert.equal(retry.status, 503);
  assert.equal(retry.headers.get("retry-after"), "60");
  assert.equal(writes, failedWrites, "requests during the backoff do not rebuild");
});
