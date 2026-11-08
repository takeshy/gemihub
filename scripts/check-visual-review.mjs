import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, planSummary, shopSchema } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';
import { proposeVisualAppearance } from '../server/visual.ts';
import { reviewRenderedVisual } from '../server/visual-review.ts';
import { createInitialTheme } from '../server/initial-theme.ts';
import { standardTheme } from '../shared/theme-editing.ts';
import { compactGeneratedStyles } from '../server/generated-design.ts';
import { captureVisualScreens } from '../server/visual-browser.ts';

process.env.DEMO_MODE = 'true';
delete process.env.GOOGLE_CLOUD_PROJECT;
await mkdir('tmp/visual-review', { recursive: true });
const store = new Store(':memory:');
const shop = await store.createShop('visual-review@example.com');
shop.published = { ...structuredClone(sample), appearance: { accent: 'sage', layout: 'standard', imageUrl: '', theme: standardTheme } };
await store.saveShop(shop);
const cookie = 'visual-review-test';
await store.put('session', digest(cookie), { user: { email: shop.owner, name: 'Owner', role: 'owner' }, expires: Date.now() + 3600000 });
let generations = 0, reviews = 0, initial = false;
const screenshotHashes = [];
const server = createApp(store, { ...intelligence,
  async identifyVisual() { return { ids: ['theme'], explanation: 'The header is selected.' }; },
  async visualAppearance(current, instruction, images, options) {
    generations++;
    const repair = /mobile navigation is clipped/.test(instruction);
    if (repair) assert.match(current.appearance.theme.headerCss, /height:20px/, 'repair starts from the rejected candidate');
    return proposeVisualAppearance(current, instruction, images, { ...options, generate: async () => JSON.stringify({ appearance: { theme: { headerCss: repair || instruction.includes('24 pixels') ? '.public-nav{gap:24px}' : '.public-nav{height:20px;overflow:hidden}' } } }) });
  },
  async initialTheme(input, context) {
    return createInitialTheme(input, context, async request => {
      if (request.purpose) return JSON.stringify({ approved: true, issues: [], imageUsage: [] });
      return JSON.stringify({ ...standardTheme, css: '.salon-hero{padding:40px}' });
    });
  },
  async visualReview(input) {
    assert.equal(input.before.name, input.after.name);
    return reviewRenderedVisual(input, { model: async request => {
      reviews++;
      assert.equal(request.purpose, 'review');
      const parts = request.contents[0].parts;
      const pixels = parts.flatMap(part => part.inlineData ? [part.inlineData] : []);
      assert.equal(pixels.length, input.media ? 5 : 4, 'the review sees the marks plus before and after at desktop/mobile widths');
      if (input.media) assert.deepEqual(pixels[0], input.media);
      const screenshots = input.media ? pixels.slice(1) : pixels;
      for (const [index, image] of screenshots.entries()) {
        const bytes = Buffer.from(image.data, 'base64');
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.format, 'jpeg');assert.equal(metadata.width, index % 2 ? 390 : 1280);
        assert.ok(metadata.height > 100);
        await writeFile(`tmp/visual-review/${initial ? 'initial' : 'header'}-${reviews}-${index}.jpg`, bytes);
      }
      const hashes = screenshots.map(image => digest(image.data));
      screenshotHashes.push(hashes);
      assert.notEqual(hashes[0], hashes[1], 'desktop and mobile are separate browser layouts');
      const broken = !initial && input.after.appearance.theme.headerCss.includes('height:20px');
      return JSON.stringify({ approved: !broken, issues: broken ? ['The mobile navigation is clipped.'] : [] });
    } });
  },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN = origin;
async function api(id, action, body, actor = cookie) {
  const response = await fetch(`${origin}/api/shops/${id}/${action}`, { method: 'POST', headers: { Origin: origin, Cookie: `gemihub_session=${actor}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();assert.equal(response.status, 200, data.error);return data;
}
try {
  const media = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
  const identified = await api(shop.id, 'visual/identify', { media, instruction: 'Increase the header navigation spacing', displayed: shop.published, local: { base: shop.revision, source: shop.published, theme: true }, screen: { id: 'theme', label: 'Entire page', file: 'web/parts/header.html' } });
  const proposal = await api(shop.id, 'visual/propose', { id: identified.id, target: 'theme', instruction: 'Increase the header navigation spacing', media });
  assert.deepEqual(proposal.visualReview, { approved: true, attempts: 2 });
  assert.equal(generations, 2);assert.equal(reviews, 2);
  assert.notDeepEqual(screenshotHashes[0].slice(2), screenshotHashes[1].slice(2), 'the repaired proposal is rendered and captured again');
  assert.deepEqual((await store.shop(shop.id)).published, shop.published, 'automatic review and repair never publish or accept the draft');
  const refined = await api(shop.id, 'visual/propose', { id: identified.id, target: 'theme', instruction: 'Make the gap 24 pixels', applied: 'Increase the header navigation spacing', revision: proposal.config });
  assert.equal(refined.visualReview.approved, true);
  assert.equal(refined.visualReview.attempts, 1);
  const setup = await store.createShop('initial-review@example.com');
  await store.put('session', digest('initial-review'), {user:{email:setup.owner,name:'Owner',role:'owner'},expires:Date.now()+3600000});
  const plan = { id: randomUUID(), shopId: setup.id, base: 0, config: shop.published, source: null, requiresSetup: true, approved: false, createdAt: Date.now(), summary: planSummary(null, shop.published), checklist: [] };
  await store.put('plan', plan.id, plan);
  initial = true;
  const changed = await api(setup.id, `plans/${plan.id}/theme`, { media, instruction: 'Increase the hero padding to 40 pixels' }, 'initial-review');
  assert.equal(changed.plan.themeReview.rendered, true);
  assert.equal((await store.shop(setup.id)).published, null);
  const oversized = structuredClone(shop.published);
  oversized.appearance.theme.css = '/* ' + 'formatting '.repeat(1500) + ' */\nh1 { letter-spacing: 0.03em; }\n@media (max-width: 600px) { h1 { letter-spacing: 0.01em; } }';
  const compacted = shopSchema.parse(compactGeneratedStyles(oversized));
  assert.ok(compacted.appearance.theme.css.length < 12000);
  const captureInput = { screen: 'theme', locale: 'ja', options: {}, images: {} };
  const beforeCompact = await captureVisualScreens({ ...captureInput, config: oversized });
  const afterCompact = await captureVisualScreens({ ...captureInput, config: compacted });
  assert.deepEqual(afterCompact.map(shot => shot.data), beforeCompact.map(shot => shot.data), 'compacting oversized formatting preserves the actual desktop/mobile pixels');
  console.log('Oversized CSS formatting compacts below the limit with identical Chromium screenshots at 1280/390px.');
  console.log('Real Chromium before/after captures reach the review model at 1280/390px. Rejection -> repair -> recapture -> approval, refinement, and initial-theme correction passed; publication is unchanged.');
} finally { await new Promise(resolve => server.close(resolve));await store.close(); }
