import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import sharp from "sharp";
import { z } from "zod";
import { fixturesSchema } from "../src/local-preview.ts";
import type { VisualPreviewData } from "../shared/visual-review.ts";
import { tr } from "../shared/i18n.ts";
import { currentAiSignal } from "./llm.ts";
import { findLowContrastText } from "../shared/contrast-check.ts";

export const visualPreviewOptionsSchema = z.object({
  fixtures: fixturesSchema.optional(), hideHeader: z.boolean().optional(), hideFooter: z.boolean().optional(), articleKey: z.string().max(240).optional(),
});
export type RenderedVisual = { width: number; height: number; mimeType: "image/jpeg"; data: string; unavailableImages: string[]; contrastIssues?: ReturnType<typeof findLowContrastText> };
// Bound browser memory independently of the number of simultaneous model requests.
let rendering: Promise<unknown> = Promise.resolve();
export async function captureVisualScreens(input: VisualPreviewData): Promise<RenderedVisual[]> {
  const previous = rendering;
  let release!: () => void;
  rendering = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await capture(input); } finally { release(); }
}
async function capture(input: VisualPreviewData): Promise<RenderedVisual[]> {
  const signal = currentAiSignal();
  signal?.throwIfAborted();
  const assets = resolve("dist");
  let browser: Browser | undefined;
  const stop = () => { void browser?.close().catch(() => {}); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"], timeout: 20000 });
    signal?.throwIfAborted();
    const context = await browser.newContext({ serviceWorkers: "block", locale: input.locale === "ja" ? "ja-JP" : "en-US", reducedMotion: "reduce" });
    const unavailableImages = new Set<string>();
    // A synthetic origin serves only our built preview bundle, never shop/API credentials.
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://visual-review.invalid" && (url.pathname === "/visual-review.html" || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname))) {
        try {
          const path = resolve(assets, `.${url.pathname}`);
          const contentType = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".html") ? "text/html" : "application/octet-stream";
          return await route.fulfill({ body: await readFile(path), contentType });
        } catch { return route.abort(); }
      }
      if (route.request().resourceType() === "image") unavailableImages.add(url.href);
      await route.abort();
    });
    const results: RenderedVisual[] = [];
    for (const width of [1280, 390]) {
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(data => { window.visualPreviewData = data; }, input);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`https://visual-review.invalid/visual-review.html?lang=${input.locale}`, { waitUntil: "load", timeout: 20000 });
      const selector = input.screen === "initial-theme" || input.screen === "theme" ? ".theme-preview" : "#visual-review-surface";
      await page.waitForFunction(selector => {
        const surface = document.querySelector(selector);
        return !!surface?.querySelector(".public-shop") && !surface.querySelector(".loading") && !window.visualPreviewPending;
      }, selector);
      // React effects, managed images, font metrics and final layout must all settle.
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await page.waitForFunction(() => [...document.images].every(image => image.complete) && ![...document.querySelectorAll(".theme-image,.managed-hero-image,.menu-image")].some(node => !(node instanceof HTMLImageElement) && !node.querySelector("img")));
      if (await page.evaluate(() => window.visualPreviewError) || errors.length) throw new Error("Visual preview failed to render");
      const surface = page.locator(selector);
      const contrastIssues = await page.evaluate(findLowContrastText, selector);
      const bounds = await surface.boundingBox();
      if (!bounds || bounds.height < 1 || bounds.height > 20000) throw new Error("Visual preview has invalid dimensions");
      const screenshot = await surface.screenshot({ type: "jpeg", quality: 85, animations: "disabled", timeout: 15000 });
      const image = await sharp(screenshot).resize({ width: 1600, height: 8000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      results.push({ width, height: Math.ceil(bounds.height), mimeType: "image/jpeg", data: image.data.toString("base64"), unavailableImages: [...unavailableImages], contrastIssues });
      await page.close();
    }
    return results;
  } catch (error) {
    throw Object.assign(new Error(tr("修正後の画面を撮影できませんでした。依頼の内容は保持しています。もう一度お試しください。"), { cause: error }), { status: 503 });
  } finally { signal?.removeEventListener("abort", stop); await browser?.close(); }
}
