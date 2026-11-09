/* Validate the built project-path PWA and offline app shell. */
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const dist = path.resolve('dist');
const prefix = '/otaku-time/';
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.display, 'standalone');
const manifestUrl = new URL(prefix + 'manifest.webmanifest', 'http://localhost');
assert.equal(new URL(manifest.start_url, manifestUrl).pathname, prefix);
assert.equal(new URL(manifest.scope, manifestUrl).pathname, prefix);
for (const size of [192, 512]) {
  const icon = manifest.icons.find(i => i.sizes === `${size}x${size}` && i.type === 'image/png');
  assert(icon, `missing ${size} icon`);
  const data = fs.readFileSync(path.join(dist, icon.src));
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(data.readUInt32BE(16), size); assert.equal(data.readUInt32BE(20), size);
}
assert(fs.existsSync(path.join(dist, 'sw.js')));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
  const file = path.resolve(dist, relative);
  if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(4183, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.route('https://graphql.anilist.co/', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [], media: [] } } }) }));
    await page.goto('http://127.0.0.1:4183/otaku-time/');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    const cdp = await context.newCDPSession(page);
    const manifestReport = await cdp.send('Page.getAppManifest');
    assert.equal(manifestReport.errors.length, 0, JSON.stringify(manifestReport.errors));
    assert(manifestReport.url.endsWith('/otaku-time/manifest.webmanifest'));
    assert.equal(JSON.parse(manifestReport.data).display, 'standalone');
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, [], JSON.stringify(installability.installabilityErrors));
    assert.equal(scope, 'http://127.0.0.1:4183/otaku-time/');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.goto('http://127.0.0.1:4183/otaku-time/?install=1&source=offline#watchlist');
    const dialog = page.getByRole('dialog', { name: 'Otaku Time' }); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Continue in Browser' }).click();
    assert.equal(new URL(page.url()).search, '?source=offline');
    assert.equal(new URL(page.url()).hash, '#watchlist');
    await context.close();
    console.log('Production manifest, PNG icons, project scope and offline app shell passed.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exit(1); });
