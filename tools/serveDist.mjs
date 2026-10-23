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

/**
 * The house bundle (src/house/pack.ts) lives on the asset host, whose CORS policy admits only the dev
 * server's origin. The tools answer its Range requests from the local export (assets/house.pack,
 * byte-identical to the upload) instead, which is also far faster than the network.
 */
export const HOUSE_PACK_URL = 'https://pub-f86f1e8e87f44fa0b55fb73275682731.r2.dev/house.pack';
const LOCAL_PACK = path.resolve('assets/house.pack');

/** The intro ship's cabin bake on the asset host (src/intro/ship/bake/cabinBake.ts). */
export const SHIP_BAKE_URL = 'https://pub-f86f1e8e87f44fa0b55fb73275682731.r2.dev/ship-cabin.bin';

/**
 * The asset host for the game's bundles, past its CORS policy (it admits only the dev server's
 * origin): the house's Range requests answered from the local export (`serveHousePack`), the cabin
 * bake fetched from the host itself by Node (outside the page's CORS) and handed over.
 */
export async function serveAssetHost(context) {
  await serveHousePack(context);
  await context.route(SHIP_BAKE_URL, async (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*' } });
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
}

async function serveHousePack(context) {
  if (!fs.existsSync(LOCAL_PACK)) return;
  const fd = fs.openSync(LOCAL_PACK, 'r');
  const size = fs.fstatSync(fd).size;
  await context.route(HOUSE_PACK_URL, async (route) => {
    const req = route.request();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'Access-Control-Allow-Headers': 'Range' } });
    const m = /bytes=(\d+)-(\d+)?/.exec(req.headers()['range'] ?? '');
    if (!m) return route.fulfill({ status: 416, headers, body: '' });
    const start = Number(m[1]);
    const end = Math.min(m[2] !== undefined ? Number(m[2]) : size - 1, size - 1);
    const body = Buffer.alloc(end - start + 1);
    fs.readSync(fd, body, 0, body.length, start);
    return route.fulfill({ status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` }, body });
  });
}
