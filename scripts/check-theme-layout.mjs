import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { SiteHeader, SiteFooter, ThemeBody } from '../src/SiteChrome.tsx';
import { sample } from '../server/domain.ts';
import { setLocaleResolver } from '../shared/i18n.ts';

// A generated theme need not know about the owner's fixed-height app header.
// Deliberately omit header height/display and footer display/font overrides.
const theme = {
  headerHtml: '<header class="atelier-header"><div class="atelier-top"><slot name="title"></slot><slot name="navigation"></slot></div><section class="atelier-hero"><div><p>A MOMENT, JUST FOR YOU</p><h2>Your time to unwind.</h2><slot name="subtitle"></slot></div><div class="atelier-art" aria-hidden="true"></div></section></header>',
  bodyHtml: '<main class="atelier-body"><slot name="content"></slot></main>',
  footerHtml: '<footer class="atelier-footer"><slot name="content"></slot></footer>',
  css: '.atelier-header{padding:clamp(16px,4vw,56px);background:#faf4e9;color:#243e34}.atelier-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);align-items:center;gap:24px}.atelier-top h1{font:32px Georgia,serif;margin:0;overflow-wrap:anywhere}.public-nav{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:0;margin:0}.public-nav :is(a,button,span){font:14px system-ui;color:inherit;background:transparent;border:0;padding:8px;overflow-wrap:anywhere;max-width:100%}.atelier-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:24px;padding-top:48px}.atelier-hero h2{font:clamp(30px,5vw,64px) Georgia,serif}.atelier-art{width:100%;aspect-ratio:1;border-radius:50% 50% 0 0;background:#284f43;max-width:260px;justify-self:center}.atelier-body{padding:24px;background:#faf4e9}.atelier-footer{padding:24px;background:#284f43;color:#fff}.atelier-footer p{margin:0}@media(max-width:600px){.atelier-top,.atelier-hero{grid-template-columns:minmax(0,1fr)}.public-nav{justify-content:flex-start}.atelier-hero{padding-top:24px}}',
};
const css = await readFile('src/style.css', 'utf8');
await mkdir('tmp/theme-layout', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
let checks = 0;
try {
  for (const language of ['ja', 'en']) for (const width of [320, 390, 768, 1280]) for (const mode of ['preview', 'customer', 'export']) {
    setLocaleResolver(() => language);
    const config = { ...structuredClone(sample), name: width <= 390 ? (language === 'en' ? 'Moon Atelier Nail and Relaxation Studio' : '月のアトリエ・ネイルとリラクゼーション') : 'Moon Atelier', description: 'A little moment for yourself.', appearance: { accent: 'sage', layout: 'standard', imageUrl: '', theme } };
    const labels = language === 'en' ? ['My page', 'Book now', 'About the shop', 'Inquiries', 'Announcements', 'Staff and services'] : ['マイページ', 'ご予約', 'お店のこと', 'お問い合わせ', 'お知らせ', 'スタッフ・サービス紹介'];
    const tag = mode === 'preview' ? 'span' : mode === 'customer' ? 'button' : 'a';
    const nav = React.createElement('nav', { className: 'public-nav' }, labels.map((label, key) => React.createElement(tag, { key, ...(tag === 'a' ? { href: '#' } : {}) }, label)));
    const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(SiteHeader, { config }, nav),
      React.createElement(ThemeBody, { config }, React.createElement('div', { className: 'theme-placeholder' }, 'Each screen’s content appears here')),
      React.createElement(SiteFooter, { config }),
    ));
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    // Also exercise a narrow editor/preview inside a desktop viewport.
    for (const container of [...new Set([width, Math.min(width, 600)])]) {
      await page.setContent(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><style>${css}</style></head><body><header class="app-header">Owner controls</header><div class="theme-preview" style="width:${container}px">${markup}</div></body></html>`);
      const file = `tmp/theme-layout/${language}-${mode}-${width}-${container}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.atelier-header');
        const boundary = header.closest('.design-boundary').getBoundingClientRect();
        const nav = header.querySelector('.public-nav');
        const elements = [...nav.children, header.querySelector('h1'), header.querySelector('h2')];
        const intersects = (a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.left < y.right - 1 && x.right > y.left + 1 && x.top < y.bottom - 1 && x.bottom > y.top + 1; };
        return {
          height: header.getBoundingClientRect().height,
          clipped: elements.filter(element => { const r = element.getBoundingClientRect(); return r.left < boundary.left - 1 || r.right > boundary.right + 1 || r.top < boundary.top - 1 || r.bottom > boundary.bottom + 1; }).map(element => element.textContent),
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          overlap: intersects(nav, header.querySelector('h1')) || intersects(nav, header.querySelector('.atelier-hero')),
          ownerHeight: document.querySelector('.app-header').getBoundingClientRect().height,
          ownerBackground: getComputedStyle(document.querySelector('.app-header')).backgroundColor,
          footerDisplay: getComputedStyle(document.querySelector('.atelier-footer')).display,
        };
      });
      assert.deepEqual(layout.clipped, [], `${file}: header content must remain inside its painted boundary`);
      assert.ok(layout.height > 86, `${file}: header grows with its contents`);
      assert.equal(layout.overflow, false, `${file}: no horizontal page overflow`);
      assert.equal(layout.overlap, false, `${file}: navigation, shop name and hero do not overlap`);
      assert.equal(layout.ownerBackground, 'rgb(255, 255, 255)', 'theme does not style owner controls');
      assert.equal(layout.ownerHeight, width <= 760 ? 68 : 86, 'owner header keeps its own height');
      assert.equal(layout.footerDisplay, 'block', 'theme footer does not inherit the owner footer flex layout');
      checks++;
    }
    await page.close();
  }
  // The structural defaults must still allow an explicitly designed grid/flex
  // layout, including themes that style element names instead of classes.
  const custom = { ...structuredClone(sample), appearance: { accent: 'sage', layout: 'standard', imageUrl: '', theme: { ...theme, headerHtml: '<header><slot name="navigation"></slot></header>', css: 'header{display:grid;height:240px;padding:32px;background:#123456}footer{display:flex;padding:30px;font-size:18px}' } } };
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style>${renderToStaticMarkup(React.createElement(React.Fragment, null, React.createElement(SiteHeader, { config: custom }, 'Navigation'), React.createElement(SiteFooter, { config: custom })))}`);
  assert.deepEqual(await page.locator('.design-root header').evaluate(element => { const s = getComputedStyle(element); return [s.display, s.height, s.paddingTop, s.backgroundColor]; }), ['grid', '240px', '32px', 'rgb(18, 52, 86)']);
  assert.deepEqual(await page.locator('.design-root footer').evaluate(element => { const s = getComputedStyle(element); return [s.display, s.paddingTop, s.fontSize]; }), ['flex', '30px', '18px']);
  await page.close();
  console.log(`Theme layout: ${checks} browser checks passed; screenshots in tmp/theme-layout`);
} finally {
  await browser.close();
}
