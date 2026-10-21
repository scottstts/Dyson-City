#!/usr/bin/env node
/**
 * Review stills of the crew's models alone (docs/crew.md), in seconds rather than a world boot:
 * the real rig, FK and materials in a plain studio light, headless Chrome with WebGPU.
 *
 *   node tools/crew-shots/shots.mjs model[:pose[@t]][/az,el[,focus,span]] …
 *
 * az, el in degrees (0, 0: from the front); focus a segment name and span the framed size (m).
 * Writes tools/out/crew/<spec>.png.
 */
import { chromium } from 'playwright-core';
import { build } from 'rolldown';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import fs from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(root, 'tools/out/crew');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });

const specs = process.argv.slice(2).length ? process.argv.slice(2) : ['hand/0,8', 'hand/35,10', 'hand/90,5', 'hand/180,8'];

const bundle = await build({
  input: join(root, 'tools/crew-shots/entry.ts'),
  platform: 'browser',
  write: false,
  output: { format: 'iife' },
  transform: { define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false' } },
  logLevel: 'silent',
});
const code = bundle.output[0].code;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[page] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  await page.route('http://localhost:4199/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><script>${code}</script></body></html>` }));
  await page.goto('http://localhost:4199/');
  for (const spec of specs) {
    const [head, view = '0,8'] = spec.split('/');
    const [model, poseAt = 'rest'] = head.split(':');
    const [pose, at = '0'] = poseAt.split('@');
    const [az, el, focus = 'full', span = '1'] = view.split(',');
    await page.evaluate(([m, p, t, a, e, f, s]) => window.shot(m, p, t, a, e, f, s), [model, pose, Number(at), Number(az), Number(el), focus, Number(span)]);
    const name = spec.replace(/[/:@,]/g, '_');
    await page.locator('canvas').screenshot({ path: join(OUT, `${name}.png`) });
    console.log(join(OUT, `${name}.png`));
  }
} finally {
  await browser.close();
}
