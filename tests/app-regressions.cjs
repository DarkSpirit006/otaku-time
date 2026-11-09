const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const server = spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', '4185', '--strictPort'], { stdio: 'ignore' });
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Test server exited before starting');
    try { if ((await fetch('http://127.0.0.1:4185/')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
}
process.on('exit', () => server.kill());
(async () => {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    let searchFails = true, pageFails = true;
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { if (!localStorage.getItem('otaku-time.watchlist.v2')) localStorage.setItem('otaku-time.watchlist.v2', JSON.stringify({ 7: { mediaId: 7, title: 'Existing show', progress: 2, status: 'paused', addedAt: 10, updatedAt: 10 } })); });
    await page.route('https://graphql.anilist.co/', async route => {
      const body = route.request().postDataJSON();
      if (body.query.includes('query Search') && searchFails) return route.fulfill({ status: 400, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
      if (body.query.includes('query Airing') && body.variables.page === 4 && pageFails) return route.fulfill({ status: 400, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
      const now = Math.floor(Date.now() / 1000);
      const media = { id: 12, title: { romaji: 'A new show' }, coverImage: {}, format: 'TV', genres: [], studios: { nodes: [] }, externalLinks: [{ site: 'Safe', url: 'https://example.com/', type: 'INFO' }, { site: 'Unsafe', url: 'javascript:alert(1)', type: 'INFO' }] };
      const isRecent = body.variables.sort?.includes('TIME_DESC');
      const schedule = [{ id: body.variables.page, episode: 3, airingAt: now + (isRecent ? -3600 : 3600 * body.variables.page), mediaId: 12, media }];
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: body.query.includes('query Details') ? { Media: media } : { Page: { pageInfo: { currentPage: body.variables.page, hasNextPage: body.variables.page < 4 }, airingSchedules: schedule, media: [] } } }) });
    });
    await page.goto('http://127.0.0.1:4185/#watchlist');
    const status = page.getByLabel('Status for Existing show');
    await status.selectOption('dropped');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('otaku-time.watchlist.v2'))['7'].status), 'dropped');
    await page.reload();
    assert.equal(await page.getByLabel('Status for Existing show').inputValue(), 'dropped');
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^Watching/ }).click();
    await page.getByText('No shows with this status. Choose another filter.').waitFor();
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^Dropped/ }).click();
    await page.getByRole('button', { name: 'Open settings' }).first().click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    const upload = settings.locator('input[type=file]');
    const file = { name: 'watchlist.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ 42: { title: 'Imported show', progress: 4, status: 'planned' } })) };
    await upload.setInputFiles(file);
    await settings.getByText('Replace your watchlist?').waitFor();
    await settings.getByRole('button', { name: 'Cancel import' }).click();
    assert.equal(await page.evaluate(() => !!JSON.parse(localStorage.getItem('otaku-time.watchlist.v2'))['7']), true);
    await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await settings.getByRole('button', { name: 'Replace watchlist' }).click();
    await page.getByText('No valid watchlist entries found in that file.').waitFor();
    assert.equal(await page.evaluate(() => !!JSON.parse(localStorage.getItem('otaku-time.watchlist.v2'))['7']), true);
    await upload.setInputFiles(file);
    await settings.getByRole('button', { name: 'Replace watchlist' }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('otaku-time.watchlist.v2') || '{}')['42']);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('otaku-time.watchlist.v2'))['42'].progress), 4);
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^All/ }).click();
    const otherTab = await context.newPage();
    await otherTab.goto('http://127.0.0.1:4185/#watchlist');
    await otherTab.evaluate(() => {
      const key = 'otaku-time.watchlist.v2', entries = JSON.parse(localStorage.getItem(key));
      entries['42'].title = 'Updated in other tab';
      localStorage.setItem(key, JSON.stringify(entries));
    });
    await page.getByLabel('Status for Updated in other tab').waitFor();
    await otherTab.close();
    const trigger = page.getByRole('button', { name: 'Search anime', exact: false }).first();
    await trigger.focus();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await page.waitForTimeout(150);
    assert(await palette.evaluate(el => el.contains(document.activeElement)));
    await page.keyboard.press('Shift+Tab');
    assert(await palette.evaluate(el => el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'hidden' });
    assert(await trigger.evaluate(el => document.activeElement === el));
    await trigger.click();
    const search = page.getByRole('dialog', { name: 'Search anime' });
    await search.getByRole('searchbox').fill('missing');
    await search.getByRole('alert').waitFor();
    assert.equal(await search.getByText('Nothing matches', { exact: false }).count(), 0);
    searchFails = false;
    await search.getByRole('button', { name: 'Try again' }).click();
    await search.getByText('Nothing matches', { exact: false }).waitFor();
    await search.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Upcoming', exact: false }).first().click();
    await page.getByRole('button', { name: 'Load further ahead' }).first().click();
    await page.getByText('Could not load more episodes.', { exact: false }).first().waitFor();
    pageFails = false;
    await page.getByRole('button', { name: 'Load further ahead' }).first().click();
    await page.waitForTimeout(200);
    assert.equal(await page.getByText('Could not load more episodes.', { exact: false }).count(), 0);
    const links = await page.evaluate(async () => (await (await import('/src/lib/api.ts')).fetchDetails(12)).externalLinks);
    assert.deepEqual(links.map(link => link.site), ['Safe']);
    const ics = await page.evaluate(async () => {
      const { buildICS } = await import('/src/lib/ics.ts');
      return buildICS([{ mediaId: 1, title: 'アニメ😀'.repeat(30), progress: 0, status: 'watching', addedAt: 0, updatedAt: 0, nextAiringAt: Math.floor(Date.now() / 1000) + 3600 }]).content;
    });
    for (const line of ics.split('\r\n')) assert(Buffer.byteLength(line, 'utf8') <= 75, 'ICS line exceeds 75 UTF-8 octets');
    assert(ics.replace(/\r\n /g, '').includes('アニメ😀'.repeat(30)));
    assert.deepEqual(errors, []);
    await context.close();

    // A single future event should not show an empty filter, and a live-only
    // schedule must remain visible even when there is no future hero.
    for (const offset of [3600, -60]) {
      const single = await browser.newContext();
      const singlePage = await single.newPage();
      await singlePage.route('https://graphql.anilist.co/', route => {
        const body = route.request().postDataJSON();
        const media = { id: 9, title: { romaji: 'Only show' }, coverImage: {}, duration: 24, genres: [], studios: { nodes: [] }, externalLinks: [] };
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: { Page: { pageInfo: { currentPage: body.variables.page, hasNextPage: false }, airingSchedules: [{ id: 9, episode: 1, airingAt: Math.floor(Date.now() / 1000) + offset, mediaId: 9, media }], media: [] } } }) });
      });
      await singlePage.goto('http://127.0.0.1:4185/');
      await singlePage.getByRole('button', { name: 'Open details for Only show' }).first().waitFor();
      assert.equal(await singlePage.getByText('Nothing in this filter for the loaded window.').count(), 0);
      await single.close();
    }

    const blocked = await browser.newContext();
    const blockedPage = await blocked.newPage();
    await blockedPage.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key === 'otaku-time.watchlist.v2') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return original.call(this, key, value); };
    });
    await blockedPage.route('https://graphql.anilist.co/', route => {
      const body = route.request().postDataJSON(), now = Math.floor(Date.now() / 1000);
      const media = { id: 1, title: { romaji: 'Storage test' }, coverImage: {}, genres: [], studios: { nodes: [] }, externalLinks: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: { Page: { pageInfo: { currentPage: body.variables.page, hasNextPage: false }, airingSchedules: [{ id: 1, episode: 2, airingAt: now + 3600, mediaId: 1, media }], media: [] } } }) });
    });
    await blockedPage.goto('http://127.0.0.1:4185/');
    await blockedPage.getByRole('button', { name: 'Track this show' }).first().click();
    await blockedPage.getByRole('button', { name: 'Watchlist', exact: false }).first().click();
    await blockedPage.getByText('Could not save to browser storage.', { exact: false }).first().waitFor();
    await blocked.close();
    console.log('App regressions passed: statuses, import confirmation and legacy map, search/load-more errors, UTF-8 calendar folding, single/live-only schedules, cross-tab sync, keyboard dialog focus, safe links, and storage failure warning.');
  } finally { await browser.close(); server.kill(); }
})().catch(error => { console.error(error); process.exit(1); });
