#!/usr/bin/env node
/**
 * Review stills of the intro's ship alone (docs/intro-ship.md), in seconds rather than a world boot:
 * its real geometry in plain studio tones, headless Chrome with WebGPU.
 *
 *   node tools/ship-shots/shots.mjs [--t seconds] ext/az,el[,span,cx,cy,cz] in/x,y,z,yaw,pitch[,fov] …
 *
 * ext: azimuth 0 from the nose, 90 from starboard; elevation in degrees; the framed span (m) and
 * the focus point (ship frame). in: the eye in the ship frame, yaw 0 forward (+ to port), pitch.
 * --real: the ship's own exterior materials (skin, lights) instead of the studio tones.
 * Writes tools/out/ship/<spec>.png.
 */
import { chromium } from 'playwright-core';
import { build } from 'rolldown';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import fs from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(root, 'tools/out/ship');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
let t = 0;
const ti = argv.indexOf('--t');
if (ti >= 0) {
  t = Number(argv[ti + 1]);
  argv.splice(ti, 2);
}
const ri = argv.indexOf('--real');
const useReal = ri >= 0;
if (ri >= 0) argv.splice(ri, 1);
const specs = argv.length ? argv : ['ext/35,18', 'ext/145,15', 'ext/270,10', 'ext/0,8,14'];

const bundle = await build({
  input: join(root, 'tools/ship-shots/entry.ts'),
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[page] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  await page.route('http://localhost:4198/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><script>${code}</script></body></html>` }));
  await page.goto('http://localhost:4198/');
  for (const spec of specs) {
    const [kind, view = ''] = spec.split('/');
    const args = view ? view.split(',').map(Number) : [];
    await page.evaluate(([k, a, tt, r]) => window.shot(k, a, tt, r), [kind, args, t, useReal]);
    const name = `${spec.replace(/[/:@,]/g, '_')}${t ? `_t${t}` : ''}${useReal ? '_real' : ''}`;
    await page.locator('canvas').screenshot({ path: join(OUT, `${name}.png`) });
    console.log(join(OUT, `${name}.png`));
  }
} finally {
  await browser.close();
}
