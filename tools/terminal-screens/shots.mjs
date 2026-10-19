#!/usr/bin/env node
/**
 * Stills of the West Gate terminal's screen alone (docs/terminal.md), in seconds rather than a
 * whole headless boot per still: the OS and the screen's own drawing code, in Chrome.
 *
 *   node tools/terminal-screens/shots.mjs [spec…]
 *
 * A spec is `keys` or `keys@seconds` (keys: u d l r e b, pressed after the boot; seconds: hold the
 * recording then playing there), `boot@seconds` (the boot, that long after the wake), or `idle`. With no spec, a review set of every page and the
 * briefings' beats. Writes tools/out/terminal/<spec>.png.
 */
import { chromium } from 'playwright-core';
import { build } from 'rolldown';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';
import fs from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(root, 'tools/out/terminal');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });

const DEFAULT = [
  'idle', 'boot@0.8', 'boot@2.2', '', 'r', 'rr@9.5', 'rr@15', 'rr@30', 'rr@37.8', 'rr@44', 'rr@54.5', 'rdr', 'rddr', 'dr', 'drr@6', 'drdr@3',
  'ddr@0.6', 'ddr@2.4', 'ddr@4.6', 'ddr@7', 'ddr@9.3', 'ddr@12.5', 'ddr@16', 'ddr@18.5', 'ddr@20.3', 'ddr@22.3', 'ddr@40',
  'dddr@1', 'dddr@2.6', 'dddr@5.5', 'dddr@10', 'dddr@20',
];
const specs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

const bundle = await build({
  input: join(root, 'tools/terminal-screens/entry.ts'),
  platform: 'browser',
  write: false,
  output: { format: 'iife' },
  transform: { define: { 'import.meta.env.BASE_URL': '"/"' } },
  logLevel: 'silent',
});
const code = bundle.output[0].code;

const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const types = { '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };
  await page.route('http://terminal.local/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${code}</script></body></html>` });
    const file = join(root, 'public', decodeURIComponent(path));
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: types[extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto('http://terminal.local/');
  // The portraits decode asynchronously.
  await page.waitForTimeout(1200);
  for (const spec of specs) {
    const [keys, at] = spec.split('@');
    const url = await page.evaluate(([k, a, idle]) => window.shot(k, a, idle), [keys === 'idle' ? '' : keys, at === undefined ? null : Number(at), keys === 'idle']);
    const name = spec === '' ? 'home' : spec.replace('@', '-');
    fs.writeFileSync(join(OUT, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${name}.png`);
  }
} finally {
  await browser.close();
}
