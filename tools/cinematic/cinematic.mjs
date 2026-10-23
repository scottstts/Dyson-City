#!/usr/bin/env node
/**
 * Offline cinematic capture (dev tool, not part of the game build).
 *
 *   node tools/cinematic/cinematic.mjs [--out ~/Downloads/clips] [--size 3443x2160] [--fps 30]
 *        [--seconds 5] [--sub 2] [--only 01-above-west,04-halo] [--preview] [--no-build]
 *
 * Builds the game with the capture overrides (overrides.mjs: no drawing-buffer cap, LOD lifted),
 * boots it once headless with ?manual, pins every three.js LOD to its finest level, and for each
 * shot (shots.mjs) drives the camera along its path and steps the real frame loop: the final
 * pipeline with TAA, eye adaptation and live game time, `--sub` frames per captured frame (the game
 * at 60 Hz for 30 fps). Each shot is settled at its first pose and pre-rolled along its move, so
 * the clip opens with TAA history and exposure as play would have them. Frames are lossless PNG;
 * each clip is encoded to ProRes 4444 (.mov), which, unlike 4:2:0 codecs, takes an odd width.
 *
 * --preview writes stills of each shot's first, middle and last frame at 1148×720 to
 * tools/out/cinematic-preview/ instead, for framing.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DIST_ORIGIN, serveDist, serveAssetHost } from '../serveDist.mjs';
import { buildCapture, CAPTURE_DIST } from './build.mjs';
import { SHOTS } from './shots.mjs';
import { poseAt } from './path.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const preview = flag('preview');
const noBuild = flag('no-build');
const out = path.resolve(opt('out', preview ? 'tools/out/cinematic-preview' : '~/Downloads/clips').replace(/^~(?=\/|$)/, os.homedir()));
const [w, h] = opt('size', preview ? '1148x720' : '3443x2160').split('x').map(Number);
const fps = Number(opt('fps', '30'));
const seconds = Number(opt('seconds', '5'));
const sub = Number(opt('sub', '2'));
const only = opt('only', '');
const shots = only ? SHOTS.filter((s) => only.split(',').includes(s.name)) : SHOTS;
if (!shots.length) throw new Error(`no shots match --only ${only}`);

/** Settling at the first pose (s of game time: exposure adaptation and TAA history), then the pre-roll along the move. */
const SETTLE_S = 3;
const PREROLL_S = 0.75;

if (!noBuild || !fs.existsSync(CAPTURE_DIST)) {
  console.info('building the capture dist…');
  await buildCapture();
}
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=WebGPU', '--enable-dawn-features=allow_unsafe_apis'],
});

try {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await serveDist(context, CAPTURE_DIST);
  await serveAssetHost(context);
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(`${DIST_ORIGIN}/?autostart&manual&spot=gate`);
  const ok = await page
    .waitForFunction(() => window.__dyson?.ready === true || document.querySelector('.entry.is-error') !== null, null, { timeout: 600_000 })
    .then(() => page.evaluate(() => window.__dyson?.ready === true));
  if (!ok) {
    console.error(logs.slice(-40).join('\n'));
    throw new Error(`boot failed: ${await page.evaluate(() => document.querySelector('.entry-message')?.textContent ?? 'unknown')}`);
  }
  console.info(`booted in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  const buffer = await page.evaluate(() => {
    const { game, world } = window.__dyson;
    // Every three.js LOD at its finest level, whatever the distance.
    let lods = 0;
    world.scene.traverse((o) => {
      if (!o.isLOD) return;
      o.autoUpdate = false;
      o.levels.forEach((l, i) => (l.object.visible = i === 0));
      lods++;
    });
    const canvas = document.querySelector('canvas');
    const scratch = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = scratch.getContext('2d');
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const cam = game.camera;
    window.__cine = {
      /** Steps the real frame loop by dt with the camera at a pose; `grab` copies the frame out in the task that rendered it. */
      async step(pose, dt, grab) {
        cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        cam.up.set(0, 1, 0);
        cam.lookAt(pose.look[0], pose.look[1], pose.look[2]);
        if (cam.fov !== pose.fov) {
          cam.fov = pose.fov;
          cam.updateProjectionMatrix();
        }
        game.renderFrame(dt);
        if (grab) ctx.drawImage(canvas, 0, 0);
        await raf();
      },
      async png() {
        const blob = await scratch.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
        return btoa(bin);
      },
      /** A new place: the star's visibility at the eye is taken as it is, not eased in from the last shot. */
      cut() {
        game.starSeen = -1;
      },
    };
    return { width: canvas.width, height: canvas.height, lods };
  });
  if (buffer.width !== w || buffer.height !== h) throw new Error(`drawing buffer is ${buffer.width}×${buffer.height}, expected ${w}×${h}`);
  console.info(`drawing buffer ${buffer.width}×${buffer.height}, ${buffer.lods} LOD objects pinned to level 0`);

  const frames = Math.round(seconds * fps);
  const dt = 1 / (fps * sub);
  /** Steps the loop from u0 to u1 of the shot's move at the capture's sub-frame rate. */
  const run = (shot, u0, u1) =>
    page.evaluate(
      async ({ shot, u0, u1, steps, dt, poses }) => {
        for (let k = 1; k <= steps; k++) await window.__cine.step(poses[k - 1], dt, false);
        return { shot, u0, u1 };
      },
      { shot: shot.name, u0, u1, steps: Math.round(((u1 - u0) * seconds) / dt), dt, poses: Array.from({ length: Math.round(((u1 - u0) * seconds) / dt) }, (_, k) => poseAt(shot, u0 + ((k + 1) * dt) / seconds)) },
    );
  const settle = async (shot, u) => {
    await page.evaluate(() => window.__cine.cut());
    if (shot.craft) {
      // The craft's visit, run forward so that it reaches `at` s into its phase at u = 0, after the
      // settle and the pre-roll: through a gap first, so a visit already under way starts afresh.
      const extra = shot.craft.at + u * seconds - SETTLE_S;
      if (extra < 0) throw new Error(`${shot.name}: craft.at must be at least ${SETTLE_S + PREROLL_S} s into ${shot.craft.phase}`);
      await page.evaluate(({ phase, extra }) => {
        const v = window.__dyson.world.vehicles;
        v.fastForward('gap', 0);
        v.fastForward(phase, extra);
      }, { phase: shot.craft.phase, extra });
    }
    const pose = poseAt(shot, u);
    await page.evaluate(
      async ({ pose, n, dt }) => {
        for (let k = 0; k < n; k++) await window.__cine.step(pose, dt, false);
      },
      { pose, n: Math.round(SETTLE_S / dt), dt },
    );
  };
  const save = async (file) => fs.writeFileSync(file, Buffer.from(await page.evaluate(() => window.__cine.png()), 'base64'));

  for (const shot of shots) {
    const t1 = Date.now();
    if (preview) {
      for (const [label, u] of [['a', 0], ['b', 0.5], ['c', 1]]) {
        await settle(shot, u - PREROLL_S / seconds);
        await run(shot, u - PREROLL_S / seconds, u - 1 / (fps * seconds));
        // The last sub-frames of the frame at u, the final one grabbed.
        const poses = Array.from({ length: sub }, (_, s) => poseAt(shot, u - (sub - 1 - s) * (dt / seconds)));
        await page.evaluate(
          async ({ poses, dt }) => {
            for (let s = 0; s < poses.length; s++) await window.__cine.step(poses[s], dt, s === poses.length - 1);
          },
          { poses, dt },
        );
        await save(path.join(out, `${shot.name}-${label}.png`));
      }
      console.info(`${shot.name}: stills (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
      continue;
    }
    const frameDir = path.join(path.resolve('tools/out/cinematic-frames'), shot.name);
    fs.rmSync(frameDir, { recursive: true, force: true });
    fs.mkdirSync(frameDir, { recursive: true });
    const u0 = -PREROLL_S / seconds;
    await settle(shot, u0);
    // The pre-roll ends one capture interval before frame 0.
    await run(shot, u0, -1 / (fps * seconds));
    for (let i = 0; i < frames; i++) {
      const u = i / (frames - 1);
      const poses = Array.from({ length: sub }, (_, s) => poseAt(shot, u - (sub - 1 - s) * (dt / seconds)));
      await page.evaluate(
        async ({ poses, dt }) => {
          for (let s = 0; s < poses.length; s++) await window.__cine.step(poses[s], dt, s === poses.length - 1);
        },
        { poses, dt },
      );
      await save(path.join(frameDir, `${String(i).padStart(5, '0')}.png`));
    }
    const file = path.join(out, `${shot.name}.mov`);
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frameDir, '%05d.png'),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv444p12le',
      '-c:v', 'prores_ks', '-profile:v', '4', '-vendor', 'apl0',
      '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-colorspace', 'bt709',
      file,
    ]);
    fs.rmSync(frameDir, { recursive: true, force: true });
    console.info(`${shot.name}: ${file} (${frames} frames, ${((Date.now() - t1) / 1000).toFixed(0)} s)`);
  }
  const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
  if (errors.length) console.error(errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
}
