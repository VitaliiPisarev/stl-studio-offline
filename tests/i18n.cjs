const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const url = pathToFileURL(path.resolve(__dirname, '../dist/STL_Studio_Offline.html')).href;
const output = path.resolve(__dirname, '../test-output/i18n');
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], headless: true });
  const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1040 } });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(url);
  await page.locator('#restart').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
  await page.locator('#zoom').fill('115');
  await page.locator('#elevation').fill('35');
  await page.locator('#model-color').fill('#69938a');
  const snapshot = () => page.evaluate(() => ({
    zoom: document.querySelector('#zoom').value,
    elevation: document.querySelector('#elevation').value,
    color: document.querySelector('#model-color').value,
    width: document.querySelector('#canvas').width, height: document.querySelector('#canvas').height,
    image: document.querySelector('#canvas').toDataURL(),
  }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const before = await snapshot();
  await page.locator('#language').selectOption('en');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = await snapshot();
  await fs.writeFile(path.join(output, 'before.png'), Buffer.from(before.image.split(',')[1], 'base64'));
  await fs.writeFile(path.join(output, 'after.png'), Buffer.from(after.image.split(',')[1], 'base64'));
  assert.deepEqual({ ...after, image: null }, { ...before, image: null });
  assert.equal(after.image === before.image, true, 'Language switching must preserve the rendered model');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#open').innerText(), '＋ Open STL / OBJ');
  assert.equal(await page.locator('#filename').innerText(), 'Demo rook');
  assert.ok((await page.locator('#model-info').innerText()).includes('triangles'));
  assert.equal(await page.locator('#canvas').getAttribute('aria-label'), '3D model');
  const untranslated = await page.evaluate(() => [...document.querySelectorAll('[data-i18n], [data-i18n-aria-label]')]
    .filter((el) => /[А-Яа-яЁё]/.test(el.textContent + (el.getAttribute('aria-label') || '')))
    .map((el) => el.dataset.i18n || el.dataset.i18nAriaLabel));
  assert.deepEqual(untranslated, [], 'All labels, help and accessibility text must have English translations');
  await page.locator('#help').click();
  assert.ok((await page.locator('#help-dialog').innerText()).includes('From model to animation'));
  await page.locator('#close-help').click();
  await page.locator('#fit').click();
  await page.screenshot({ path: path.join(output, 'interface-en.png'), fullPage: true });
  // Invalid-model errors remain translatable after they have already been shown.
  await page.locator('#file').setInputFiles({ name: 'broken.stl', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Could not open'));
  assert.ok((await page.locator('#status').innerText()).includes('empty or damaged'));
  await page.locator('#language').selectOption('ru');
  assert.ok((await page.locator('#status').innerText()).includes('пустой или повреждён'));
  await page.locator('#language').selectOption('en');
  assert.ok((await page.locator('#status').innerText()).includes('empty or damaged'));
  // Test actual files in English and retain a result link across language changes.
  await page.locator('#size').selectOption('480');
  await page.locator('#duration').selectOption('2');
  await page.locator('#fps').selectOption('10');
  const exported = [];
  for (const format of ['png', 'gif', 'mp4', 'webm']) {
    if (format === 'mp4') {
      const supported = await page.evaluate(async () => 'VideoEncoder' in window && (await VideoEncoder.isConfigSupported({ codec: 'avc1.420033', width: 480, height: 480, bitrate: 2000000, framerate: 10 })).supported);
      if (!supported) continue;
    }
    await page.locator('#format').selectOption(format);
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
    await page.locator('#export').click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, `english.${format}`));
    await page.waitForFunction(() => !document.body.classList.contains('busy'));
    assert.ok((await page.locator('#status').innerText()).startsWith('Done:'));
    assert.ok((await page.locator('#result-info').innerText()).includes('MB'));
    assert.equal(await page.locator('#language').isEnabled(), true);
    exported.push(format);
  }
  const href = await page.locator('#download').getAttribute('href');
  await page.locator('#language').selectOption('ru');
  assert.ok((await page.locator('#result-info').innerText()).includes('МБ'));
  assert.equal(await page.locator('#download').getAttribute('href'), href);
  await page.locator('#language').selectOption('en');
  // Names are user data, never translated or replaced by the demo label.
  await page.locator('#file').setInputFiles({ name: 'sample.obj', mimeType: 'text/plain', buffer: Buffer.from('v 0 0 0\nv 20 0 0\nv 0 20 0\nv 0 0 20\nf 1 3 2\nf 1 2 4\nf 2 3 4\nf 3 1 4\n') });
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Model loaded.'));
  await page.locator('#language').selectOption('ru');
  assert.equal(await page.locator('#filename').innerText(), 'sample.obj');
  await page.locator('#language').selectOption('en');
  assert.equal(await page.locator('#filename').innerText(), 'sample.obj');
  // Saved selection must apply on startup, including the demo and dynamic controls.
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#language').inputValue(), 'en');
  assert.equal(await page.locator('#filename').innerText(), 'Demo rook');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'mobile-en.png'), fullPage: true });
  assert.equal(await page.locator('#language').isVisible(), true);
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.ok(noOverflow, 'Language selector must fit a narrow window');
  // Blocked storage must not prevent startup or switching.
  const restricted = await browser.newContext({ offline: true });
  await restricted.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  const restrictedPage = await restricted.newPage();
  restrictedPage.on('pageerror', (error) => errors.push(error.message));
  await restrictedPage.goto(url);
  await restrictedPage.locator('#language').selectOption('en');
  assert.equal(await restrictedPage.locator('#open').innerText(), '＋ Open STL / OBJ');
  await restrictedPage.reload();
  assert.equal(await restrictedPage.locator('html').getAttribute('lang'), 'ru');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  const report = { languages: ['ru', 'en'], exported, preservesView: true, translatesExistingErrors: true,
    preservesDownload: true, preservesFileNames: true, remembersLanguage: true, blockedStorageFallback: true,
    narrowLayout: true, offline: true, errors, requests };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
