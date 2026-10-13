# Star: erupting gas

Code: `src/sky/star/gas/`. A port of the coronal-gas solver in `refs/solar-observatory.html` (only its gas bursts). It replaced the kinematic jets, surges, prominence eruptions and CME fronts; quiescent prominences (`magnetic.ts`) stay.

## Domain

- **The plane of the sky round the limb, unwrapped**: position angle × height. A sight line's place in it is its impact parameter and position angle (as the corona's table), so it needs no 3D placement. The gas is a sky overlay anchored to the observer; the star's drift under it (~0.8°/min) is negligible over a burst's life.
- **All round the limb.** From the shell the star is at the zenith and its whole limb is above the horizon, so bursts can appear wherever you look.
- **Polar metric in every operator** (x spacing r·Δψ, the v_r/r and v_ψ/r terms). Cells are square at the limb.
- **Top of the grid at 0.25 R; gas tops out ~0.15 R.** Gas dissipates over the upper 30 % of the grid, so nothing meets an edge in the sky. If bursts are made taller, raise `GAS_TOP` with them. Sight lines can reach 0.41 R, at the horizon.
- **Noise is written in the plane's Cartesian coordinates**, so there is no seam where the position angle wraps.

## Look and tuning

- **Time-lapsed on purpose.** This is the one exception to the star's real-time rule (`sky.md`): plumes rise ~0.05 R/s and a burst billows, rolls and dissipates in well under a minute, as in the reference.
- **Size and spacing are tuned values.** Bursts are about half (0.52×) the reference's proportions to the star, from 14 vents. Every length scales together: vent radius and height, launch speed, buoyancy, gravity, turbulence, the speed clamp and the eddy frequency. The grid (2,560 cells round the limb) was sized with them, so a plume still spans ~20 cells.
- **Vents** vent a little gas all the time (12 %), pulse once per 16–28 s cycle, and move to a new site in their sector every 3 cycles.
- **Colour is temperature.** A blackbody's colour runs from 3,300 K (gold, in cooled gas) to 5,300 K (hot white, a little under the photosphere, in fresh cores).
- **Brightness** follows T⁴ × (1 − e^−τ)². The square is the emission measure (thin plasma emits as density²), saturating when thick. Calibrated on the solved field: the densest cores are ~3× the disc mean (as the jets were), bodies ~1×, wisps ~0.1×. In the normal view only fresh cores register in the blaze.
- **The 2D field owns silhouette and motion.** Six jittered depth slices of eddy noise, drifting with the gas's age, erode it and give it depth. The field is read with a cubic B-spline, and two consecutive steps are blended so 30 Hz steps play smoothly (one step behind, at no copy cost).

## Dissipation

A burst should tear into wisps and thin out, not switch off.
- **Temperature is heat / density.** The reference's regularised heat / (density + 0.08) read thin gas as cold; with brightness in T⁴, plumes blacked out at once.
- **Erosion grows as gas thins**, so low-density gas breaks up before it is gone.
- **Density e-folds in ~17 s** (the reference's 11 s cut bursts short).

## Rejected and pitfalls

- **Plain 1 − e^−τ emission:** it saturates early, so plumes read as uniform smoke.
- **Visible-band Planck brightness:** 20× between the cool and hot ends, so cooling gas vanished.
- **Unbounded age:** it ran to thousands of seconds in empty cells, where half floats step by seconds. The age-driven drift then jumped from cell to cell and streaked the gas. Age is clamped at 60 s.
- **Ridged filaments** are ~4× sharper than their lattice, so they fade by that below the pixel footprint.

## Cost

19 fullscreen passes per step (14 Jacobi) on ~260k half-float cells. About 0.8 ms GPU and 0.2–0.5 ms CPU per step, at 30 steps/s. 20 s are pre-rolled at boot.
