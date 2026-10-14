# Runtime and boot

Code: `src/main.ts`, `src/app/`, `src/core/`.

- **Entry points.** `main.ts` gates the platform and imports `app/boot.ts` dynamically. The whole startup is one promise chain with a terminal catch through `fatal.report`. `Game` (`app/game.ts`) only owns the camera, player, pipeline and frame loop. World assembly lives in `app/world.ts`, and each system lives in its own module.
- **Boot stages:**
  - renderer;
  - atmosphere (atmosphere LUTs and the star glare table in one worker, noise volumes in another);
  - environment (async: the star illuminant measurement, then the environment capture);
  - compile;
  - warmup;
  - first frame;
  - running.
  Each stage is logged with its duration.
- **Ordering constraints:**
  - Noise volumes must be set before any star shader is built.
  - The space backdrop is baked (and the frame angle set) before the sky is built.
  - The illuminant must be measured before the environment capture.
  - White-balance gains are set when the pipeline is created.
- **Hidden-tab frames.** `nextFrame` falls back to a 100 ms timeout, because requestAnimationFrame stalls in hidden panes during boot.
- **GPU errors.** Device-loss and error callbacks are installed before `renderer.init()`, chained to Three's defaults. Any GPU error during boot aborts startup. Fatal runtime errors stop the loop and show the entry screen's error panel.
- **Viewport.** DPR policy and resize coalescing are in `core/viewport.ts`, following the project rules.
- **Debug URL parameters** (`debug/params.ts`): `spot`, `view` (incl. `glare`), `sky` (incl. `space`), `tm`, `ev`, `time`, `fov`, `look`, `ao`, `probe`, `profile`, `autostart`, `wobble`, `steady`, `manual`. `tools/probe-hdr.mjs` reads back scene radiance at screen points for calibration.
  - **Local hosts only** (`isDebugHost`: localhost, loopback, `*.localhost`). On a deployed host every parameter is ignored and `window.__dyson` is not installed, so the review tools only work against a local server.
  - The sky debug mode is set after the environment capture, so debug views keep the normal lighting.
- **No dev server.** `render.mjs` and `fps.mjs` take `--dist <dir>` to load a `vite build` with nothing listening on a port: the browser's requests to http://localhost are answered from the build by request interception (`tools/serveDist.mjs`).
- **Headless renders.** `node tools/render.mjs [--query ...] spot…` renders fixed viewpoints (`debug/viewpoints.ts`). It prints exposure, the star illuminant and GPU time (with `profile`). The first render of a batch runs slow (GPU warm-up); profile with a warm-up spot first.
- **Motion clips.** `node tools/clip.mjs --seconds 20 --query "fov=24&look=20,47" spot` boots once with `?manual`, steps real game time (four TAA sub-frames per captured frame) and encodes an MP4 with ffmpeg (`--speed` scales game time, `--start` jumps the clock).
- **Frame rate.** `node tools/fps.mjs spot…` counts uncapped frames of the real loop (vsync off, frozen star time). The `?profile` timestamp sum overstates pipelines of many small passes on tile-based GPUs, and costs depend on what is on screen (an erupting prominence, say): compare at a fixed `time`.
- **Flicker meter.** `node tools/flicker.mjs --wobble 3 --steady spot…` boots with `?manual`, steps frames by hand while the camera sweeps its yaw (37-frame period, ±3° ≈ 10 px/frame at the turn), and captures the frame at the same phase of every sweep. The view is identical, so per-pixel differences are temporal instability. It prints mean and 99.9th-percentile σ and writes a heat map.
  - With `--steady` the camera speed at each capture is identical too, and only the TAA jitter phase differs: this isolates aliasing and crawl.
  - Without it, TAA's normal softening under motion is mixed in, and high-contrast detail inflates the numbers.
  - A WebGPU canvas is only readable in the task that rendered it, so the capture happens right after `renderFrame`.
