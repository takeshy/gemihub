import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { sample } from '../server/domain.ts';
process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
process.env.GOOGLE_CLIENT_ID = 'customer-email-browser-test';
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), mails = [];
const shop = await store.createShop('owner@example.com');
shop.published = structuredClone(sample); shop.publication = 'public'; await store.saveShop(shop);
const server = createApp(store, undefined, undefined, undefined, undefined, undefined, async (_shop, to, _subject, text) => { mails.push({ to, text }); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
await mkdir('tmp/email-login', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
let active;
try {
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    for (const returning of [false, true]) {
      const email = `${returning ? 'returning' : 'new'}-${language}-${width}@example.com`;
      if (returning) await store.put('customer', `${shop.id}:${email}`, { shopId: shop.id, email, name: 'Existing member', birthDate: '1990-01-01', gender: 'not_specified' });
      const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
      const page = await context.newPage(); active = page; const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/s/${shop.slug}?lang=${language}`);
      await page.locator('.public-auth').getByRole('link', { name: label('会員登録・ログイン'), exact: true }).click();
      let dialog = page.getByRole('dialog', { name: label('会員登録・ログイン'), exact: true });
      const googleLink = new URL(await dialog.getByRole('link', { name: label('Googleでログイン'), exact: true }).getAttribute('href'));
      assert.equal(googleLink.pathname, '/auth/google'); assert.equal(googleLink.searchParams.get('shop'), shop.slug);
      await dialog.getByLabel(label('メールアドレス'), { exact: true }).fill(email);
      await dialog.getByRole('button', { name: label('認証メールを送る'), exact: true }).click();
      await expect(dialog.getByText(label('メールを確認してください'), { exact: true })).toBeVisible();
      const mail = mails.find(message => message.to === email); assert.ok(mail);
      const link = mail.text.match(/https?:\/\/\S+/)[0];
      assert.equal(new URL(link).searchParams.get('lang'), language);
      assert.equal((await (await context.request.get(origin + '/api/session')).json()).user, null);
      if (!returning) await dialog.screenshot({ path: `tmp/email-login/sent-${language}-${width}.png` });
      // Email links also work in a different browser from the one that requested them.
      const verificationContext = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
      const verification = await verificationContext.newPage(); active = verification; verification.on('pageerror', error => errors.push(error.message));
      const verificationLink = new URL(link);
      if (width === 390) verificationLink.searchParams.delete('pane'); // Legacy links open the static home first.
      await verification.goto(verificationLink.href);
      dialog = verification.getByRole('dialog', { name: label('メールアドレスを確認'), exact: true });
      await expect(dialog.getByText(email, { exact: true })).toBeVisible();
      assert.equal((await (await verificationContext.request.get(origin + '/api/session')).json()).user, null, 'opening the link must not sign in automatically');
      assert.equal(new URL(verification.url()).hash, '', 'the secret is removed from browser history');
      assert.ok(await dialog.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }));
      if (!returning) await dialog.screenshot({ path: `tmp/email-login/confirmation-${language}-${width}.png` });
      await dialog.getByRole('button', { name: label('メールアドレスを確認してログイン'), exact: true }).click();
      if (returning) {
        await expect(verification.locator('.member-information')).toContainText('Existing member');
        await expect(verification.locator('.customer-registration')).toHaveCount(0);
      } else {
        const registration = verification.locator('.customer-registration');
        await expect(registration).toBeVisible();
        await expect(registration.getByLabel(label('お名前'), { exact: true })).toHaveValue('');
        await registration.getByLabel(label('お名前'), { exact: true }).fill('New member');
        await registration.getByLabel(label('生年月日'), { exact: true }).fill('1990/01/01');
        await registration.getByLabel(label('性別'), { exact: true }).selectOption('not_specified');
        await registration.getByRole('button', { name: label('登録して予約へ進む'), exact: true }).click();
        await expect(registration).toHaveCount(0);
        assert.equal((await store.get('customer', `${shop.id}:${email}`)).name, 'New member');
      }
      assert.equal((await (await verificationContext.request.get(origin + '/api/session')).json()).user.email, email);
      assert.equal(await store.get('user', email), undefined);
      await verification.goto(link);
      await expect(verification.getByRole('alert')).toContainText(label('認証リンクが無効か、有効期限が切れています。もう一度メールを送ってください。'));
      assert.deepEqual(errors, []); await verificationContext.close(); await context.close();
    }
    console.log(`${language} ${width}px: email entry, confirmation on another browser, registration, returning member, single-use links and Google-free customer sessions passed`);
  }
} catch (error) {
  if (active && !active.isClosed()) await active.screenshot({ path: 'tmp/email-login/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
