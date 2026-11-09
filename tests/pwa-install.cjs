/* Browser-mocked install flow tests. These do not install an OS application. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const server = spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', '4182', '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
const base = 'http://127.0.0.1:4182/';
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('Vite server failed to start');
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('Vite server timed out');
}
async function newPage(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://graphql.anilist.co/', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [], media: [] }, Media: { id: 7, title: { romaji: 'Test anime' }, coverImage: {}, studios: { nodes: [] }, externalLinks: [] } } }) }));
  return { context, page, errors };
}
async function mockPrompt(page, outcome, fail = false) {
  return page.evaluate(({ outcome, fail }) => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.userChoice = Promise.resolve({ outcome, platform: 'web' });
    event.prompt = () => {
      window.__promptCalls = (window.__promptCalls || 0) + 1;
      return fail ? Promise.reject(new Error('unavailable')) : Promise.resolve({ outcome, platform: 'web' });
    };
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, { outcome, fail });
}
(async () => {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    // Shared-link opening and History API cleanup retain query, hash and state.
    let { context, page, errors } = await newPage(browser);
    await page.goto(base + '?install=1&source=discord#watchlist');
    const sheet = page.getByRole('dialog', { name: 'Otaku Time' });
    await sheet.waitFor();
    assert.equal(new URL(page.url()).searchParams.get('install'), '1');
    assert.equal(await page.locator('nav.fixed button[aria-current="page"]').innerText(), 'Watchlist');
    assert.equal(await sheet.getByRole('button', { name: 'Install Otaku Time' }).count(), 0);
    assert(await sheet.getByText(/Chrome or Edge/).isVisible());
    await page.evaluate(() => history.replaceState({ retained: true }, '', location.href));
    await sheet.getByRole('button', { name: 'Continue in Browser' }).click();
    await page.waitForTimeout(300);
    assert.equal(new URL(page.url()).search, '?source=discord');
    assert.equal(new URL(page.url()).hash, '#watchlist');
    assert.equal(await page.evaluate(() => history.state.retained), true);
    assert.deepEqual(errors, []);
    await context.close();

    // Unrelated query bytes, empty flags and repeated parameters are untouched.
    ({ context, page, errors } = await newPage(browser));
    await page.goto(base + '?a=one%20two&install=1&flag&x=%7e&x=2#recent');
    await page.getByRole('dialog', { name: 'Otaku Time' }).getByRole('button', { name: 'Close installation' }).click();
    assert.equal(new URL(page.url()).search, '?a=one%20two&flag&x=%7e&x=2');
    assert.equal(new URL(page.url()).hash, '#recent');
    assert.deepEqual(errors, []);
    await context.close();

    // Normal visit, deferred event before opening Settings, accepted then appinstalled.
    ({ context, page, errors } = await newPage(browser));
    await page.goto(base);
    assert.equal(await page.getByRole('dialog', { name: 'Otaku Time' }).count(), 0);
    assert.equal(await mockPrompt(page, 'accepted'), true);
    assert.equal(await page.evaluate(() => window.__promptCalls || 0), 0);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: /Install Otaku Time/ }).click();
    const install = page.getByRole('dialog', { name: 'Otaku Time' });
    await install.getByRole('button', { name: 'Install Otaku Time' }).click();
    assert.equal(await page.evaluate(() => window.__promptCalls), 1);
    await install.getByText(/Installation accepted/).waitFor();
    assert.equal(await install.getByText('Installed', { exact: true }).count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await install.getByText('Installed', { exact: true }).waitFor();
    assert.equal(await install.getByRole('button', { name: 'Install Otaku Time' }).count(), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Otaku Time' }).waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    await context.close();

    // Dismissal consumes the event; a fresh event can later be used. Failures get fallback.
    ({ context, page, errors } = await newPage(browser));
    await page.goto(base + '?install=1');
    assert.equal(await mockPrompt(page, 'dismissed'), true);
    await page.getByRole('button', { name: 'Install Otaku Time' }).click();
    await page.getByText(/Installation was dismissed/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Install Otaku Time' }).count(), 0);
    assert.equal(await mockPrompt(page, 'accepted', true), true);
    await page.getByRole('button', { name: 'Install Otaku Time' }).click();
    await page.getByText(/install prompt is unavailable/i).waitFor();
    assert.equal(await page.evaluate(() => window.__promptCalls), 2);
    assert.deepEqual(errors, []);
    await context.close();

    // Android fallback and iOS/iPadOS manual instructions, including installed mode.
    for (const [ua, ipad] of [
      ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', false],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', false],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', true],
    ]) {
      ({ context, page, errors } = await newPage(browser, { userAgent: ua, hasTouch: true, isMobile: true }));
      if (ipad) await page.addInitScript(() => { Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }); Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); });
      await page.goto(base + '?install=1');
      const dialog = page.getByRole('dialog', { name: 'Otaku Time' });
      await dialog.waitFor();
      if (/Android/.test(ua)) await dialog.getByText(/Create shortcut/).waitFor();
      else { await dialog.getByText(/Open as Web App/).waitFor(); await dialog.getByText(/Add to Home Screen/).waitFor(); }
      assert.equal(await dialog.getByRole('button', { name: 'Install Otaku Time' }).count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
    ({ context, page, errors } = await newPage(browser, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1', hasTouch: true, isMobile: true }));
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    await page.goto(base + '?install=1');
    await page.getByRole('dialog', { name: 'Otaku Time' }).getByText('Installed', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Install Otaku Time' }).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();

    // Standard display-mode standalone detection (separate from iOS standalone).
    ({ context, page, errors } = await newPage(browser));
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : original(query);
    });
    await page.goto(base + '?install=1');
    await page.getByRole('dialog', { name: 'Otaku Time' }).getByText('Installed', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Install Otaku Time' }).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();

    // A details hash is preserved and its dialog resumes after the install sheet closes.
    ({ context, page, errors } = await newPage(browser));
    await page.goto(base + '?install=1&source=share#show/7');
    const installWithDetails = page.getByRole('dialog', { name: 'Otaku Time' });
    await installWithDetails.waitFor();
    await installWithDetails.getByRole('button', { name: 'Continue in Browser' }).click();
    await page.getByRole('dialog', { name: 'Test anime' }).waitFor();
    assert.equal(new URL(page.url()).search, '?source=share');
    assert.equal(new URL(page.url()).hash, '#show/7');
    assert.deepEqual(errors, []);
    await context.close();

    // Command palette and themes. URL stays untouched when opened normally.
    ({ context, page, errors } = await newPage(browser, { viewport: { width: 1100, height: 850 } }));
    await page.goto(base + '?source=desktop#recent');
    await page.getByRole('button', { name: 'Open settings' }).waitFor({ state: 'attached' });
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: 'Install Otaku Time' }).click();
    await page.getByRole('dialog', { name: 'Otaku Time' }).waitFor();
    await page.getByRole('button', { name: 'Close installation' }).click();
    assert.equal(new URL(page.url()).search, '?source=desktop');
    assert.equal(new URL(page.url()).hash, '#recent');
    await page.evaluate(() => { localStorage.setItem('otaku-time.theme.v1', 'light'); });
    await page.reload(); await page.waitForTimeout(150); await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: 'Install Otaku Time' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.getByRole('dialog', { name: 'Otaku Time' }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();

    console.log('PWA install flow passed (mocked browser APIs; no real OS installation).');
  } finally { await browser.close(); server.kill(); }
})().catch(error => { console.error(error); process.exit(1); });
