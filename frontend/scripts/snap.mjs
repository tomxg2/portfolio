// Visual-regression snapshots for the 3D scene (solar view + cockpit).
//
//   node scripts/snap.mjs --baseline        capture reference shots
//   node scripts/snap.mjs                   capture + diff against the baseline
//   node scripts/snap.mjs --views solar,cockpit
//
// Needs the dev server on http://localhost:5199 (override with --url) — the
// window.__ship / window.__snap hooks it drives are dev-only.
//
// Rendering is reproducible run-to-run: performance.now + requestAnimationFrame
// are stubbed so the scene only advances when the script steps frames manually,
// and Math.random is seeded so star fields etc. come out identical. Screenshots
// therefore diff near-pixel-exact; anything above the threshold is a real
// visual change.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAP = join(dirname(fileURLToPath(import.meta.url)), 'snapshots');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const URL = opt('url', 'http://localhost:5199');
const BASELINE = flag('baseline');
const CHANGED_PCT = 0.05;   // a view "changed" if more than this % of pixels moved

// look = [yaw, pitch]; null keeps the default seat aim
const ALL_VIEWS = [
  { name: 'solar',         mode: 'solar' },
  { name: 'cockpit',       mode: 'cockpit', look: null },
  { name: 'cockpit-dash',  mode: 'cockpit', look: [0, -0.42] },
  { name: 'cockpit-left',  mode: 'cockpit', look: [-1.5, 0.05] },
  { name: 'cockpit-right', mode: 'cockpit', look: [1.5, 0.05] },
  { name: 'cockpit-aft',   mode: 'cockpit', look: [3.0, 0.02] },
];
const wanted = opt('views', '').split(',').filter(Boolean);
const VIEWS = wanted.length ? ALL_VIEWS.filter((v) => wanted.includes(v.name)) : ALL_VIEWS;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('fd-wake-seen', '1');
  // seeded PRNG — star fields and other mount-time randomness repeat exactly
  let s = 0x9e3779b9;
  Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  // manual clock: the scene only advances when the script calls __tick()
  let now = 0;
  const q = [];
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => q.push(cb);
  window.cancelAnimationFrame = () => {};
  window.__tick = (frames = 1, ms = 1000 / 60) => {
    for (let i = 0; i < frames; i++) { now += ms; for (const cb of q.splice(0)) cb(now); }
  };
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(URL, { waitUntil: 'load' });
// DOM overlays run on the wall clock — kill CSS motion so it can't flicker diffs
await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
await page.evaluate(() => document.fonts.ready);

// step fixed frame batches with real pauses between them, so async texture/GLB
// fetches resolve at the same frame count every run
const settle = async (batches, frames = 4, ms = 1000 / 60, pause = 250) => {
  for (let i = 0; i < batches; i++) {
    await page.evaluate(({ f, m }) => window.__tick(f, m), { f: frames, m: ms });
    await new Promise((r) => setTimeout(r, pause));
  }
};
console.log('loading scene…');
// zero-duration frames: rAF still fires (ResizeObserver → Canvas mount → loaders)
// but the clock stays at t=0, so slow/fast asset loads can't phase-shift the
// animations — planet positions depend only on the fixed per-view stepping below
await settle(40, 4, 0, 200);
await page.waitForLoadState('networkidle').catch(() => {});
await settle(10, 4, 0, 200); // decode/PMREM slack after the last fetch
await page.evaluate(() => {
  if (!window.__ship) throw new Error('window.__ship missing — is this a dev build on ' + location.href + '?');
});

const outDir = join(SNAP, BASELINE ? 'baseline' : 'current');
mkdirSync(outDir, { recursive: true });
const shots = {};
for (const v of VIEWS) {
  await page.evaluate((mode) => {
    const st = window.__ship.getState();
    if (st.mode !== mode) (mode === 'cockpit' ? st.enterCockpit() : st.exitCockpit());
    if (mode === 'solar' && window.__orbit?.current) {
      // pin the camera: auto-rotate drifts by a fixed angle per rendered frame,
      // and the pre-mount frame count varies with load timing
      const c = window.__orbit.current;
      c.autoRotate = false;
      c.object.position.set(0, 26, 56);
      c.target.set(0, 0, 0);
      c.update();
    }
  }, v.mode);
  // the cockpit clamps per-frame delta to 0.05s, so 60 frames = 3s scene time —
  // covers the nav-screen power-on (1.9s) and lets every camera/FOV lerp converge
  await settle(6, 10, 100, 150);
  if (v.look) {
    await page.evaluate((l) => window.__snap.look(l[0], l[1]), v.look);
    await settle(1, 10, 100, 100);
  }
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(join(outDir, `${v.name}.png`), buf);
  shots[v.name] = buf;
  console.log(`  ${v.name} → ${join(outDir, `${v.name}.png`)}`);
}

if (!BASELINE) {
  mkdirSync(join(SNAP, 'diff'), { recursive: true });
  const dp = await ctx.newPage();  // blank page = clean canvas playground for the diff
  let fail = false;
  console.log('\nview            changed   verdict');
  for (const v of VIEWS) {
    const bPath = join(SNAP, 'baseline', `${v.name}.png`);
    if (!existsSync(bPath)) { console.log(`${v.name.padEnd(15)} —         no baseline (run --baseline first)`); continue; }
    const r = await dp.evaluate(async ({ a, b }) => {
      const load = (u) => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = 'data:image/png;base64,' + u; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const W = ia.width, H = ia.height;
      const draw = (im) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0); return x; };
      const xa = draw(ia), xb = draw(ib);
      const da = xa.getImageData(0, 0, W, H).data, db = xb.getImageData(0, 0, W, H).data;
      const out = xb.createImageData(W, H);
      let changed = 0;
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const d = Math.max(Math.abs(da[o] - db[o]), Math.abs(da[o + 1] - db[o + 1]), Math.abs(da[o + 2] - db[o + 2]));
        if (d > 16) { changed++; out.data[o] = 255; out.data[o + 1] = 40; out.data[o + 2] = 40; }
        else { const g = (da[o] * 0.2126 + da[o + 1] * 0.7152 + da[o + 2] * 0.0722) * 0.3; out.data[o] = out.data[o + 1] = out.data[o + 2] = g; }
        out.data[o + 3] = 255;
      }
      xb.putImageData(out, 0, 0);
      return { pct: (changed / (W * H)) * 100, url: xb.canvas.toDataURL('image/png') };
    }, { a: readFileSync(bPath).toString('base64'), b: shots[v.name].toString('base64') });
    writeFileSync(join(SNAP, 'diff', `${v.name}.png`), Buffer.from(r.url.split(',')[1], 'base64'));
    const changed = r.pct >= CHANGED_PCT;
    if (changed) fail = true;
    console.log(`${v.name.padEnd(15)} ${(r.pct.toFixed(3) + '%').padEnd(9)} ${changed ? 'CHANGED → see snapshots/diff/' + v.name + '.png' : 'ok'}`);
  }
  process.exitCode = fail ? 1 : 0;
}
await browser.close();
