/**
 * Serverless loading of a vite build for the headless tools: the browser context's requests to
 * http://localhost are answered from the build directory by request interception. Nothing listens
 * on a port; localhost keeps the debug parameters (debug/params.ts) and WebGPU's secure context.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DIST_ORIGIN = 'http://localhost';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

/** Routes every request to DIST_ORIGIN in `context` (a Playwright BrowserContext) to files under `dir`. */
export async function serveDist(context, dir) {
  const root = path.resolve(dir);
  await context.route(`${DIST_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file !== root && !file.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: 'forbidden' });
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: MIME[path.extname(file)] ?? 'application/octet-stream' });
  });
}
