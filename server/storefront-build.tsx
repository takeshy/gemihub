import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { articleKinds } from "../shared/article-features.ts";
import { StaticStorefront, staticViewPath, type StaticStorefrontView } from "../src/StaticStorefront.tsx";
import { requestLocale } from "./i18n.ts";
import { localizeShell } from "../shared/html.ts";
import { escapeHtml } from "./artifacts.ts";
import { withImageSources } from "./image-references.ts";
import { postKey, postLabel, type PublicPost } from "./post-domain.ts";
import type { MenuImageData } from "./menu-image-domain.ts";
import type { Shop } from "./store.ts";
import type { StorefrontFiles } from "./storefront-files.ts";

/**
 * Bump when the generated markup changes in a way existing shops should receive.
 * Releases from an older generator keep being served until they are rebuilt in the background.
 */
export const storefrontRenderer = 2;
/** `assets` are shop-level files (`shops/{id}/assets/{name}`) the pages refer to; absent on releases before renderer 2. */
export type StorefrontRelease = { id: string; paths: string[]; assets?: string[]; renderer?: number };
export type StorefrontAsset = { body: Buffer; contentType: string };
export type StorefrontBuild = { pages: Record<string, string>; assets: Record<string, StorefrontAsset> };
export type StorefrontShell = { html: string; css: string };

const prefix = (shopId: string, release: string) => `shops/${shopId}/releases/${release}/`;
export const storefrontObject = (shopId: string, release: StorefrontRelease, path: string) => prefix(shopId, release.id) + path;
export const storefrontAssetObject = (shopId: string, name: string) => `shops/${shopId}/assets/${name}`;
/** Asset names are a SHA-256 of their bytes, so URLs can be cached forever. */
export const storefrontAssetName = /^[a-f0-9]{64}\.(?:css|png|jpg|gif|webp)$/;
export const storefrontAssetType = (name: string) => ({ css: "text/css; charset=utf-8", png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as Record<string, string>)[name.split(".").pop()!] || "application/octet-stream";
const imageExtension: Record<MenuImageData["mimeType"], string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const assetName = (body: Buffer, extension: string) => `${createHash("sha256").update(body).digest("hex")}.${extension}`;

export function storefrontFile(path: string, hosted: boolean, locale: string) {
  const file = !path ? "index.html" : path.endsWith(".xml") ? path : `${path}.html`;
  return `${locale}/${hosted ? "host" : "path"}/${file}`;
}
export function canonicalBase(shop: Pick<Shop, "slug" | "domain" | "domainVerified">, origin: string) {
  return shop.domainVerified && shop.domain ? `https://${shop.domain}` : process.env.SITE_DOMAIN ? `https://${shop.slug}.${process.env.SITE_DOMAIN}` : `${origin}/s/${shop.slug}`;
}
const plainText = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);

/** The built app CSS is captured with the release, so future app deployments cannot change an older published page. */
export async function storefrontShell(): Promise<StorefrontShell> {
  let html = await readFile(resolve("dist/index.html"), "utf8");
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/gi, "");
  const css: string[] = [];
  for (const match of [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)]) {
    const path = match[0].match(/href=["'](\/assets\/[a-zA-Z0-9_.-]+\.css)["']/)?.[1];
    if (!path) throw new Error("Invalid storefront stylesheet path");
    css.push(await readFile(resolve("dist", `.${path}`), "utf8"));
    html = html.replace(match[0], "");
  }
  return { html, css: css.join("\n") };
}

export function buildStorefront(shop: Shop, posts: PublicPost[], origin: string, shell: StorefrontShell, images: Record<string, MenuImageData> = {}): StorefrontBuild {
  const canonical = canonicalBase(shop, origin), noindex = shop.publication === "provisional" || !!shop.judge;
  const assets: Record<string, StorefrontAsset> = {};
  const addAsset = (body: Buffer, extension: string, contentType: string) => { const name = assetName(body, extension); assets[name] = { body, contentType }; return name; };
  const stylesheet = shell.css ? addAsset(Buffer.from(shell.css), "css", storefrontAssetType("x.css")) : undefined;
  const imageNames = Object.fromEntries(Object.entries(images).map(([id, image]) => [id, addAsset(Buffer.from(image.data, "base64"), imageExtension[image.mimeType], image.mimeType)]));
  const published = shop.published!;
  const live = posts.filter(post => articleKinds(published).includes(post.category));
  // Link previews need an absolute URL; a managed header image is served from the canonical address.
  const headerImage = published.header.imageId && imageNames[published.header.imageId] ? `${canonical}/_assets/${imageNames[published.header.imageId]}` : published.header.imageUrl.startsWith("https://") ? published.header.imageUrl : undefined;
  const pages: Record<string, string> = {};
  for (const locale of ["ja", "en"] as const) requestLocale.run(locale, () => {
    for (const hosted of [false, true]) {
      const base = hosted ? "" : `/s/${shop.slug}`;
      const sources = Object.fromEntries(Object.entries(imageNames).map(([id, name]) => [id, `${base}/_assets/${name}`]));
      const c = withImageSources(published, sources);
      const render = (view: StaticStorefrontView, title: string, description: string) => {
        const path = staticViewPath(view), post = view.kind === "article" ? view.post : undefined;
        const url = path ? `${canonical}/${path}` : new URL(canonical).href;
        // Each language has its own URL so both can be indexed; Japanese is the default.
        const localized = (language: string) => language === "ja" ? url : `${url}?lang=${language}`;
        const text = plainText(description);
        const jsonLd = post ? { "@context": "https://schema.org", "@type": post.category === "blogs" ? "BlogPosting" : "Article", headline: post.title, datePublished: post.publishedAt || post.date, url: localized(locale), inLanguage: locale, publisher: { "@type": "Organization", name: c.name }, ...(headerImage ? { image: headerImage } : {}) } : !path ? { "@context": "https://schema.org", "@type": "LocalBusiness", name: c.name, ...(c.description ? { description: c.description } : {}), ...(c.address ? { address: c.address } : {}), url, ...(headerImage ? { image: headerImage } : {}) } : undefined;
        const head = [
          `<title>${escapeHtml(title)}</title>`,
          stylesheet && `<link rel="stylesheet" href="${base}/_assets/${stylesheet}">`,
          text && `<meta name="description" content="${escapeHtml(text)}">`,
          noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${escapeHtml(localized(locale))}"><link rel="alternate" hreflang="ja" href="${escapeHtml(localized("ja"))}"><link rel="alternate" hreflang="en" href="${escapeHtml(localized("en"))}"><link rel="alternate" hreflang="x-default" href="${escapeHtml(localized("ja"))}">`,
          `<meta property="og:title" content="${escapeHtml(title)}">`,
          text && `<meta property="og:description" content="${escapeHtml(text)}">`,
          `<meta property="og:url" content="${escapeHtml(localized(locale))}">`,
          `<meta property="og:type" content="${post ? "article" : "website"}">`,
          `<meta property="og:locale" content="${locale === "en" ? "en_US" : "ja_JP"}">`,
          headerImage && `<meta property="og:image" content="${escapeHtml(headerImage)}">`,
          `<meta name="twitter:card" content="${headerImage ? "summary_large_image" : "summary"}">`,
          jsonLd && !noindex && `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
          post && `<meta name="gemihub-post-category" content="${post.category}"><meta name="gemihub-post-title" content="${escapeHtml(post.title)}"><meta name="gemihub-post-date" content="${post.date}">`,
        ].filter(Boolean).join("");
        const body = renderToStaticMarkup(<StaticStorefront config={c} view={view} base={base} provisional={shop.publication === "provisional"} imageSources={sources} />);
        pages[storefrontFile(path, hosted, locale)] = localizeShell(shell.html).replace(/<title>.*?<\/title>/s, "").replace("</head>", () => `${head}</head>`).replace('<div id="root"></div>', () => `<div id="root" data-page="static-storefront" data-shop-base="${escapeHtml(base)}">${body}</div><script defer src="/storefront-login.js"></script>`);
      };
      render({ kind: "home", posts: live }, c.name, c.description);
      for (const category of articleKinds(c)) render({ kind: "archive", category, posts: live }, `${postLabel(category)} | ${c.name}`, c.description);
      for (const post of live) render({ kind: "article", post }, `${post.title} | ${c.name}`, post.excerpt || post.body);
      for (const page of c.pages) render({ kind: "page", page }, `${page.title} | ${c.name}`, page.body);
      if (!noindex) {
        const paths = ["", ...articleKinds(c), ...live.map(post => `${post.category}/${postKey(post)}`), ...c.pages.map(page => `pages/${page.slug}`)];
        const loc = (path: string) => path ? `${canonical}/${path}` : new URL(canonical).href;
        pages[storefrontFile("sitemap.xml", hosted, locale)] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths.map(path => `<url><loc>${escapeHtml(loc(path))}</loc><xhtml:link rel="alternate" hreflang="ja" href="${escapeHtml(loc(path))}"/><xhtml:link rel="alternate" hreflang="en" href="${escapeHtml(`${loc(path)}?lang=en`)}"/></url>`).join("")}</urlset>\n`;
      }
    }
  });
  return { pages, assets };
}

/** Writes assets, then pages; the caller commits the returned pointer only after every object exists. */
export async function writeStorefront(files: StorefrontFiles, shopId: string, build: StorefrontBuild): Promise<StorefrontRelease> {
  const paths = Object.keys(build.pages).sort(), assets = Object.keys(build.assets).sort(), hash = createHash("sha256");
  hash.update(JSON.stringify([storefrontRenderer, assets]));
  for (const path of paths) hash.update(JSON.stringify([path, build.pages[path]]));
  const release: StorefrontRelease = { id: hash.digest("hex"), paths, assets, renderer: storefrontRenderer };
  for (const name of assets) await files.write(storefrontAssetObject(shopId, name), build.assets[name].body, build.assets[name].contentType);
  for (const path of paths) await files.write(storefrontObject(shopId, release, path), build.pages[path], `${path.endsWith(".xml") ? "application/xml" : "text/html"}; charset=utf-8`);
  return release;
}

/** Releases kept besides the current one, so pages a browser already holds keep finding their assets. */
export const storefrontRetainedReleases = 2;
/** Objects of releases that fell out of retention and are not shared with a kept release. */
export function storefrontGarbage(shopId: string, kept: StorefrontRelease[], dropped: StorefrontRelease[]) {
  const keptIds = new Set(kept.map(release => release.id)), keptAssets = new Set(kept.flatMap(release => release.assets || []));
  return [
    ...dropped.filter(release => !keptIds.has(release.id)).flatMap(release => release.paths.map(path => storefrontObject(shopId, release, path))),
    ...[...new Set(dropped.flatMap(release => release.assets || []))].filter(name => !keptAssets.has(name)).map(name => storefrontAssetObject(shopId, name)),
  ];
}
