import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

// Check every story, including HTTP previews where Web Crypto is unavailable.
const root = resolve("storybook-static");
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${new URL(req.url, "http://localhost").pathname}`);
    assert.ok(path.startsWith(`${root}/`));
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" })[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
    // A non-loopback hostname exercises a real insecure browser context.
    args: ["--no-sandbox", "--no-proxy-server", "--host-resolver-rules=MAP storybook.test 127.0.0.1"],
  });
  const index = JSON.parse(await readFile(resolve(root, "index.json"), "utf8"));
  const entries = Object.values(index.entries).filter(entry => entry.type === "story");
  assert.ok(entries.length > 0);
  const failures = [];
  for (const language of ["ja", "en"]) for (const host of ["127.0.0.1", "storybook.test"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    let errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/")) errors.push(`Live API request: ${request.url()}`);
    });
    for (const entry of entries) {
      errors = [];
      try {
        await page.goto(`http://${host}:${port}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
        await page.locator("#storybook-root h1, #storybook-root h2").first().waitFor({ state: "attached" });
        assert.equal(await page.locator("html").getAttribute("lang"), language);
        assert.equal(await page.evaluate(() => isSecureContext), host === "127.0.0.1");
        await page.waitForFunction(() => {
          const editor = document.querySelector(".local-preview");
          return !editor || editor.querySelector(".local-preview-screen") || /画面を読み込めませんでした|Unable to load this screen/.test(editor.textContent);
        });
        // Let the asynchronous effects and their error handlers finish rendering.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.getByText("画面を読み込めませんでした。ページを再読み込みしてください。", { exact: true }).count(), 0);
        assert.deepEqual(await page.locator('#storybook-root [role="alert"]').allTextContents(), []);
        assert.deepEqual(errors, []);
      } catch (error) {
        failures.push({ host, story: entry.id, error: error.message, alerts: await page.locator('[role="alert"]').allTextContents() });
      }
    }
    console.log(`${language} ${host}: checked ${entries.length} stories`);
    await context.close();
  }
  assert.deepEqual(failures, []);
  const manager = await browser.newPage();
  await manager.goto(`http://127.0.0.1:${port}/index.html?path=/story/${encodeURIComponent(entries[0].id)}`);
  await manager.getByText("Management / 運営", { exact: true }).first().waitFor();
  await manager.close();
  console.log("All stories loaded in secure and insecure contexts, without loading errors or live API requests. Bilingual explorer verified.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
