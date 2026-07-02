// Generates tileable normal + roughness maps from the cockpit color textures.
// Runs the image math inside headless Chrome (same-origin canvas via the dev
// server), writes <name>_n.jpg and <name>_r.jpg next to the sources.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const OUT = '/Users/tom/Secondbrain/portfolio/frontend/public/textures/cockpit';
const NAMES = [
  { name: 'wall', strength: 2.4 },
  { name: 'floor', strength: 2.8 },
  { name: 'ceiling', strength: 1.8 },
  { name: 'dash', strength: 1.6 },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded' });

for (const { name, strength } of NAMES) {
  const res = await page.evaluate(async ({ name, strength }) => {
    const img = new Image();
    await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = `/textures/cockpit/${name}.jpg?raw`; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const src = cx.getImageData(0, 0, W, H).data;

    // luminance height field
    const lum = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) lum[i] = (src[i * 4] * 0.2126 + src[i * 4 + 1] * 0.7152 + src[i * 4 + 2] * 0.0722) / 255;
    // 2-pass box blur (radius 2), wrapping so the result stays tileable
    const blur = (a) => {
      const out = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += a[y * W + ((x + k + W) % W)];
        out[y * W + x] = s / 5;
      }
      const out2 = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += out[((y + k + H) % H) * W + x];
        out2[y * W + x] = s / 5;
      }
      return out2;
    };
    const h = blur(blur(lum));

    // sobel -> tangent-space normal (wrapping)
    const nrm = cx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const L = (xx, yy) => h[((yy + H) % H) * W + ((xx + W) % W)];
      const dx = (L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1));
      const dy = (L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1; // +Y up (three.js convention)
      const il = 1 / Math.hypot(nx, ny, nz);
      const o = (y * W + x) * 4;
      nrm.data[o] = (nx * il * 0.5 + 0.5) * 255;
      nrm.data[o + 1] = (ny * il * 0.5 + 0.5) * 255;
      nrm.data[o + 2] = (nz * il * 0.5 + 0.5) * 255;
      nrm.data[o + 3] = 255;
    }
    cx.putImageData(nrm, 0, 0);
    const nURL = cv.toDataURL('image/jpeg', 0.92);

    // roughness: bright emissive/metal details -> glossier, grime -> rougher
    const rgh = cx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = Math.max(0.34, Math.min(0.86, 0.82 - lum[i] * 0.42)) * 255;
      rgh.data[i * 4] = rgh.data[i * 4 + 1] = rgh.data[i * 4 + 2] = v;
      rgh.data[i * 4 + 3] = 255;
    }
    cx.putImageData(rgh, 0, 0);
    const rURL = cv.toDataURL('image/jpeg', 0.9);
    return { nURL, rURL, W, H };
  }, { name, strength });

  writeFileSync(`${OUT}/${name}_n.jpg`, Buffer.from(res.nURL.split(',')[1], 'base64'));
  writeFileSync(`${OUT}/${name}_r.jpg`, Buffer.from(res.rURL.split(',')[1], 'base64'));
  console.log(`${name}: ${res.W}x${res.H} -> ${name}_n.jpg, ${name}_r.jpg`);
}
await browser.close();
