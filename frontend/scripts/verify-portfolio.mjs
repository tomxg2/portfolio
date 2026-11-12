import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const screenshots = join(root, 'scripts/snapshots/portfolio');
let browser;
let server;
let baseUrl;

before(async () => {
  process.chdir(root);
  await build({ root, logLevel: 'warn' });
  server = await preview({ root, logLevel: 'silent', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await mkdir(screenshots, { recursive: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => {
    server.httpServer.close(resolve);
    server.httpServer.closeIdleConnections?.();
  });
});

async function openPage(viewport = { width: 1440, height: 1000 }, mobile = false) {
  const context = await browser.newContext({
    viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' : undefined,
  });
  await context.addInitScript(() => { try { localStorage.setItem('fd-wake-seen', '1'); } catch {} });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { page, close: async () => { await context.close(); assert.deepEqual(errors, [], 'Unexpected browser errors'); } };
}

async function openHome(page, hash = '') {
  await page.goto(`${baseUrl}/${hash}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Tom Hiestand', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

test('homepage exposes work without downloading the 3D runtime', async () => {
  const { page, close } = await openPage();
  try {
    const scripts = [];
    page.on('request', (request) => { if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname); });
    await openHome(page);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.ok(!scripts.some((path) => /\/App-|Scene3D|vision_bundle|emulate|react-three/.test(path)), scripts.join('\n'));
    const bytes = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter((entry) => /\/assets\/.*\.js/.test(entry.name))
      .reduce((total, entry) => total + entry.decodedBodySize, 0));
    assert.ok(bytes > 0 && bytes < 400000, `Homepage JavaScript: ${bytes} bytes`);
    assert.equal(await page.locator('.portfolio-feature img').evaluate((image) => image.naturalWidth), 1920);
    await page.screenshot({ path: join(screenshots, 'desktop-home.png') });
  } finally { await close(); }
});

test('project details are keyboard-operable and section deep links survive reload', async () => {
  const { page, close } = await openPage();
  try {
    await openHome(page);
    const summaries = await page.locator('.portfolio-project summary').all();
    assert.equal(summaries.length, 1);
    await page.getByRole('heading', { name: 'Airform', exact: true }).waitFor();
    for (const summary of summaries) {
      await summary.focus();
      await summary.press('Enter');
      assert.equal(await summary.evaluate((element) => element.parentElement.open), true);
      await summary.press('Space');
      assert.equal(await summary.evaluate((element) => element.parentElement.open), false);
    }
    await openHome(page, '#contact');
    await page.waitForFunction(() => {
      const heading = document.getElementById('contact-heading').getBoundingClientRect();
      return heading.top >= 0 && heading.top < innerHeight;
    });
    await page.waitForFunction(() => document.querySelector('nav[aria-label="Main navigation"] a[href="#contact"]')?.getAttribute('aria-current') === 'location');
    await page.screenshot({ path: join(screenshots, 'desktop-contact.png') });
  } finally { await close(); }
});

test('contact form validates, recovers from errors, trims payloads, and announces success', async () => {
  const { page, close } = await openPage();
  try {
    await openHome(page, '#contact');
    await page.getByRole('button', { name: 'Send Message' }).click();
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 3);
    await page.waitForFunction(() => document.activeElement?.name === 'name');
    await page.getByLabel('Name', { exact: true }).fill('  Audit Visitor  ');
    await page.getByLabel('Email', { exact: true }).fill('audit@example.test');
    await page.getByLabel('Message', { exact: true }).fill('  Local browser verification only.  ');
    const payloads = [];
    await page.route('**/api/contact', async (route) => {
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      payloads.push(route.request().postDataJSON());
      if (payloads.length === 1) return route.fulfill({ status: 502, headers, contentType: 'text/html', body: 'Unavailable' });
      if (payloads.length === 2) return route.fulfill({ status: 400, headers, json: { details: [{ field: 'email', message: 'Please provide a valid email address' }] } });
      if (payloads.length === 3) return route.fulfill({ status: 429, headers, json: { error: 'Too many messages. Try again later.' } });
      return route.fulfill({ status: 200, headers, json: { success: true } });
    });
    await page.getByRole('button', { name: 'Send Message' }).click();
    await page.getByRole('alert').filter({ hasText: 'Your message could not be sent.' }).waitFor();
    await page.getByRole('button', { name: 'Send Message' }).click();
    await page.getByRole('alert').filter({ hasText: 'Please provide a valid email address' }).waitFor();
    await page.waitForFunction(() => document.activeElement?.name === 'email');
    await page.getByLabel('Email', { exact: true }).fill('audit@example.test');
    await page.getByRole('button', { name: 'Send Message' }).click();
    await page.getByRole('alert').filter({ hasText: 'Too many messages.' }).waitFor();
    await page.getByRole('button', { name: 'Send Message' }).click();
    const success = page.getByRole('status').filter({ hasText: 'Message sent!' });
    await success.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'status');
    assert.equal(payloads.length, 4);
    assert.deepEqual(payloads[0], { name: 'Audit Visitor', email: 'audit@example.test', message: 'Local browser verification only.' });
  } finally { await close(); }
});

test('a stalled submission times out and leaves the form usable', async () => {
  const { page, close } = await openPage();
  try {
    await openHome(page, '#contact');
    await page.clock.install();
    await page.route('**/api/contact', () => {});
    await page.getByLabel('Name', { exact: true }).fill('Audit Visitor');
    await page.getByLabel('Email', { exact: true }).fill('audit@example.test');
    await page.getByLabel('Message', { exact: true }).fill('Local timeout verification only.');
    await page.getByRole('button', { name: 'Send Message' }).click();
    await page.getByRole('button', { name: 'Sending' }).waitFor();
    await page.clock.fastForward(16000);
    await page.getByRole('alert').filter({ hasText: 'The request timed out.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Send Message' }).isEnabled(), true);
  } finally { await close(); }
});

test('six viewport sizes keep navigation, text, and fields within their bounds', async () => {
  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
    { width: 844, height: 390 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 },
  ]) {
    const { page, close } = await openPage(viewport, viewport.width <= 390);
    try {
      await openHome(page);
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('.portfolio h1, .portfolio h2, .portfolio h3, .portfolio summary, .portfolio input, .portfolio textarea'))
        .filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1; })
        .map((element) => element.textContent || element.tagName));
      assert.deepEqual(overflow, [], `${viewport.width}px overflow`);
      const workTop = await page.locator('#work-heading').evaluate((element) => element.getBoundingClientRect().top);
      assert.ok(workTop < viewport.height, `${viewport.width}px first view hides the work section`);
      await page.screenshot({ path: join(screenshots, `home-${viewport.width}.png`) });
      if (viewport.width === 390) {
        await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Contact' }).tap();
        await page.getByLabel('Name', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(screenshots, 'mobile-contact.png') });
      }
    } finally { await close(); }
  }
});

async function canvasPixels(page) {
  return page.locator('canvas[data-engine]').evaluate((canvas) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No rendered canvas frame within five seconds')), 5000);
    requestAnimationFrame(() => {
      clearTimeout(timeout);
      const context = canvas.getContext('webgl2');
      const pixels = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4);
      context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, pixels);
      let bright = 0;
      for (let offset = 0; offset < pixels.length; offset += 16) if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 40) bright++;
      resolve(bright);
    });
  }));
}

test('the optional experiment renders on desktop and mobile and returns to the portfolio', { timeout: 90000 }, async () => {
  for (const mobile of [false, true]) {
    const { page, close } = await openPage(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, mobile);
    try {
      await page.goto(`${baseUrl}/lab`, { waitUntil: 'networkidle' });
      await page.locator('canvas[data-engine]').waitFor();
      await page.waitForTimeout(2500);
      assert.ok(await canvasPixels(page) > 50, '3D canvas is blank');
      await page.screenshot({ path: join(screenshots, mobile ? 'mobile-lab.png' : 'desktop-lab.png') });
      await page.getByRole('button', { name: 'Enter cockpit', exact: true }).click();
      await page.getByRole('button', { name: 'Exit cockpit', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Exit cockpit', exact: true }).click();
      await Promise.all([
        page.waitForURL(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 20000 }),
        page.getByRole('link', { name: 'Back to portfolio' }).click({ noWaitAfter: true }),
      ]);
      await page.getByRole('heading', { name: 'Tom Hiestand', exact: true }).waitFor();
      assert.equal(await page.locator('canvas').count(), 0);
    } finally { await close(); }
  }
});

test('WebGL failure keeps project content and the return link usable', async () => {
  const { page, close } = await openPage();
  try {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type === 'webgl2' ? null : original.call(this, type, ...args);
      };
    });
    await page.goto(`${baseUrl}/lab`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '3D preview unavailable' }).waitFor();
    await page.getByRole('navigation', { name: 'Portfolio sections' }).getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: 'Personal Side projects' }).click();
    await page.getByRole('heading', { name: 'Personal Projects' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: 'Back to portfolio' }).click();
    await page.getByRole('heading', { name: 'Tom Hiestand', exact: true }).waitFor();
  } finally { await close(); }
});

async function openInstrument(page) {
  await page.goto(`${baseUrl}/instrument`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Airform.', exact: true }).waitFor();
  assert.equal(await page.locator('.airform').evaluate((element) => getComputedStyle(element).display), 'flex');
}

async function startInstrument(page) {
  await page.getByRole('button', { name: 'Start playing', exact: true }).click();
  await page.getByRole('button', { name: 'Mute instrument', exact: true }).waitFor();
}

async function installInstrumentCamera(page, mode = 'mock') {
  await page.addInitScript((mode) => {
    const state = window.__cameraTest = { requests: [], stopped: 0, frames: 0, visible: true, pinching: true };
    const createStream = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      context.fillStyle = '#263a30';
      context.fillRect(0, 0, 320, 240);
      const stream = canvas.captureStream(25);
      let frame = 0;
      const timer = setInterval(() => {
        context.fillStyle = frame++ % 2 ? '#263a30' : '#273b31';
        context.fillRect(0, 0, 320, 240);
      }, 40);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); state.stopped++; stop(); };
      }
      state.stream = stream;
      return stream;
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      state.requests.push(constraints);
      if (mode === 'denied') throw new DOMException('Denied for this test', 'NotAllowedError');
      if (mode === 'pending') return new Promise((resolve) => { state.resolve = () => resolve(createStream()); });
      return createStream();
    };
    if (mode !== 'real') {
      window.Hands = class {
        setOptions() {}
        onResults(callback) { this.callback = callback; }
        async initialize() { if (mode === 'model-error') throw new Error('Model unavailable'); }
        async close() {}
        async send() {
          state.frames++;
          const landmarks = Array.from({ length: 21 }, () => ({ x: 0.55, y: 0.7, z: 0 }));
          landmarks[8] = { x: 0.24, y: 0.32, z: 0 };
          landmarks[4] = { x: state.pinching ? 0.26 : 0.85, y: 0.33, z: 0 };
          this.callback({ multiHandLandmarks: state.visible ? [landmarks] : [] });
        }
      };
    }
  }, mode);
}

test('instrument plays real audio, changes notes and voices, and exports a playable take', { timeout: 60000 }, async () => {
  const { page, close } = await openPage({ width: 1440, height: 900 });
  try {
    const deployment = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
    const policy = deployment.headers.find((rule) => rule.source === '/(.*)').headers
      .find((header) => header.key === 'Content-Security-Policy').value;
    await page.route('**/instrument', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
    });
    await installInstrumentCamera(page, 'denied');
    await openInstrument(page);
    assert.equal(await page.getByRole('button', { name: 'Record performance' }).isEnabled(), false);
    assert.equal(await page.evaluate(() => window.__cameraTest.requests.length), 0);
    assert.ok(await canvasPixels(page) > 50);
    await page.screenshot({ path: join(screenshots, 'instrument-desktop.png') });
    await startInstrument(page);
    await page.getByRole('button', { name: 'Record performance', exact: true }).click();
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor();
    const stage = page.getByRole('region', { name: 'Pitch and tone performance surface' });
    const bounds = await stage.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.65);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('[aria-label="Current note"]').textContent === 'G3');
    await page.waitForFunction(() => Number(document.querySelector('[aria-label="Output level"]').getAttribute('aria-valuenow')) > 1);
    await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.25, { steps: 10 });
    await page.waitForFunction(() => document.querySelector('[aria-label="Current note"]').textContent === 'A4');
    await page.screenshot({ path: join(screenshots, 'instrument-playing.png') });
    await page.mouse.up();
    for (const note of ['D3', 'F3', 'G3']) {
      const key = await page.getByRole('button', { name: `Play ${note}`, exact: true }).boundingBox();
      await page.mouse.move(key.x + key.width / 2, key.y + key.height / 2);
      await page.mouse.down();
      await page.waitForFunction((note) => document.querySelector('[aria-label="Current note"]').textContent === note, note);
      await page.mouse.up();
    }
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    await page.getByRole('link', { name: 'Download recording', exact: true }).waitFor();
    const recorded = await page.evaluate(async () => {
      const blob = await (await fetch(document.querySelector('.airform-take audio').src)).blob();
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        const samples = audio.getChannelData(0);
        let squared = 0;
        for (let index = 0; index < samples.length; index += 8) squared += samples[index] ** 2;
        return { bytes: blob.size, duration: audio.duration, rms: Math.sqrt(squared / (samples.length / 8)) };
      } finally { await context.close(); }
    });
    assert.ok(recorded.bytes > 1000 && recorded.duration > 0.3 && recorded.rms > 0.0001, JSON.stringify(recorded));
    await page.getByRole('button', { name: 'Play recording', exact: true }).click();
    await page.getByRole('button', { name: 'Pause recording playback', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pause recording playback', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download recording', exact: true }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^airform-take\.(webm|ogg|m4a)$/);
    await download.saveAs(join(screenshots, download.suggestedFilename()));
    for (const voice of ['Reed', 'Current', 'Glass']) {
      await page.getByRole('button', { name: voice, exact: true }).click();
      await stage.focus();
      await page.keyboard.down('a');
      await page.waitForFunction(() => document.querySelector('[aria-label="Current note"]').textContent === 'D3');
      await page.keyboard.up('a');
    }
    await page.getByRole('combobox', { name: 'Key', exact: true }).selectOption('C');
    await page.getByRole('combobox', { name: 'Scale', exact: true }).selectOption('major');
    assert.equal(await page.getByRole('group', { name: 'Playable notes' }).getByRole('button').count(), 15);
    await page.getByRole('button', { name: 'Mute instrument', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Current note"]').textContent === '--');
    await page.waitForFunction(() => Number(document.querySelector('[aria-label="Output level"]').getAttribute('aria-valuenow')) === 0);
    assert.equal(await page.evaluate(() => window.__cameraTest.requests.length), 0);
  } finally { await close(); }
});

test('instrument maps a pinch to sound, releases a missing hand, and stops the camera', { timeout: 30000 }, async () => {
  const { page, close } = await openPage();
  try {
    await installInstrumentCamera(page);
    await openInstrument(page);
    await startInstrument(page);
    await page.getByRole('button', { name: 'Hands', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Current note"]').textContent === 'A4');
    assert.equal(await page.evaluate(() => window.__cameraTest.requests[0].audio), false);
    await page.evaluate(() => { window.__cameraTest.visible = false; });
    await page.waitForFunction(() => document.querySelector('[aria-label="Current note"]').textContent === '--');
    await page.getByRole('button', { name: 'Pointer', exact: true }).click();
    await page.waitForFunction(() => window.__cameraTest.stopped > 0);
    assert.equal(await page.locator('.airform-camera video').evaluate((video) => video.srcObject), null);
  } finally { await close(); }
});

test('instrument handles denied, failed, and cancelled camera startup without leaking streams', { timeout: 45000 }, async () => {
  for (const mode of ['denied', 'model-error', 'pending']) {
    const { page, close } = await openPage();
    try {
      await installInstrumentCamera(page, mode);
      await openInstrument(page);
      await page.getByRole('button', { name: 'Hands', exact: true }).click();
      if (mode === 'pending') {
        await page.waitForFunction(() => typeof window.__cameraTest.resolve === 'function');
        await page.getByRole('button', { name: 'Pointer', exact: true }).click();
        await page.evaluate(() => window.__cameraTest.resolve());
      } else {
        await page.getByRole('alert').waitFor();
        await page.waitForFunction(() => document.querySelector('.airform-inputs button').getAttribute('aria-pressed') === 'true');
      }
      if (mode !== 'denied') await page.waitForFunction(() => window.__cameraTest.stopped > 0);
      assert.equal(await page.getByRole('button', { name: 'Start playing', exact: true }).isEnabled(), true);
      assert.equal(await page.locator('.airform-camera video').evaluate((video) => video.srcObject), null);
    } finally { await close(); }
  }
});

test('instrument loads the actual local MediaPipe model and processes generated video', { timeout: 60000 }, async () => {
  const { page, close } = await openPage();
  try {
    await installInstrumentCamera(page, 'real');
    await openInstrument(page);
    await page.addScriptTag({ url: `${baseUrl}/mediapipe/hands.js` });
    await page.evaluate(() => {
      const NativeHands = window.Hands;
      window.Hands = function(options) {
        const hands = new NativeHands(options);
        const onResults = hands.onResults.bind(hands);
        hands.onResults = (callback) => onResults((results) => { window.__cameraTest.frames++; callback(results); });
        return hands;
      };
    });
    await page.getByRole('button', { name: 'Hands', exact: true }).click();
    await page.waitForFunction(() => window.__cameraTest.frames >= 2, undefined, { timeout: 30000 });
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Pointer', exact: true }).click();
    await page.waitForFunction(() => window.__cameraTest.stopped > 0);
  } finally { await close(); }
});

test('instrument stays playable across desktop, phone, and landscape layouts', { timeout: 60000 }, async () => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    const mobile = viewport.width <= 390;
    const { page, close } = await openPage(viewport, mobile);
    try {
      await openInstrument(page);
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('.airform-header button, .airform-header a, .airform select, .airform input, .airform-transport button, .airform h1'))
        .filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1; })
        .map((element) => element.getAttribute('aria-label') || element.textContent));
      assert.deepEqual(overflow, [], `${viewport.width}px controls overflow`);
      const pitch = await page.locator('.airform-note').boundingBox();
      const axis = await page.locator('.airform-axis span').first().boundingBox();
      const overlap = Math.min(pitch.x + pitch.width, axis.x + axis.width) > Math.max(pitch.x, axis.x) &&
        Math.min(pitch.y + pitch.height, axis.y + axis.height) > Math.max(pitch.y, axis.y);
      assert.equal(overlap, false, `${viewport.width}px pitch readout overlaps its axis`);
      assert.ok(await canvasPixels(page) > 50);
      await page.screenshot({ path: join(screenshots, `instrument-${viewport.width}.png`) });
      if (mobile) {
        await page.getByRole('button', { name: 'Start playing', exact: true }).tap();
        await page.getByRole('button', { name: 'Mute instrument', exact: true }).waitFor();
        const key = page.getByRole('button', { name: 'Play D3', exact: true });
        await key.focus();
        await key.press('Space');
        const stage = await page.getByRole('region', { name: 'Pitch and tone performance surface' }).boundingBox();
        await page.touchscreen.tap(stage.x + stage.width / 2, stage.y + stage.height / 2);
        await page.waitForFunction(() => Number(document.querySelector('[aria-label="Output level"]').getAttribute('aria-valuenow')) > 0);
      }
    } finally { await close(); }
  }
});