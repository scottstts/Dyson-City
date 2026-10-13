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
  - The illuminant must be measured before the environment capture.
  - White-balance gains are set when the pipeline is created.
- **Hidden-tab frames.** `nextFrame` falls back to a 100 ms timeout, because requestAnimationFrame stalls in hidden panes during boot.
- **GPU errors.** Device-loss and error callbacks are installed before `renderer.init()`, chained to Three's defaults. Any GPU error during boot aborts startup. Fatal runtime errors stop the loop and show the entry screen's error panel.
- **Viewport.** DPR policy and resize coalescing are in `core/viewport.ts`, following the project rules.
- **Debug URL parameters** (`debug/params.ts`): `spot`, `view` (incl. `glare`), `sky`, `tm`, `ev`, `time`, `fov`, `look`, `ao`, `probe`, `profile`, `autostart`. `tools/probe-hdr.mjs` reads back scene radiance at screen points for calibration.
- **Headless renders.** `node tools/render.mjs [--query ...] spot…` renders fixed viewpoints (`debug/viewpoints.ts`). It prints exposure, the star illuminant and GPU time (with `profile`). The first render of a batch runs slow (GPU warm-up); profile with a warm-up spot first.
