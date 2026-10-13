/**
 * The star's erupting gas: a 2D Eulerian fluid (stable fluids) over the plane of the sky round the
 * limb (domain.ts), not a scrolling texture. Vents (vents.ts) inject momentum and hot gas; hot gas
 * is buoyant and cooling dense gas falls back; vorticity confinement and a little turbulence roll
 * it into eddies. Density, heat and age are advected with the projected velocity, so plumes expand,
 * curl and cool into translucent wisps.
 *
 * Schedule per fixed step: curl → advect velocity + forces → divergence → Jacobi → project →
 * advect gas + injection. Every pass is a fullscreen TSL pass into half-float targets. Operators
 * carry the polar metric (x spacing r·Δψ, the v_r/r and v_ψ/r terms); x wraps round the limb.
 * The rotation of the local basis between a cell and its back-traced point (< 0.01 rad per step)
 * is neglected.
 *
 * State (half float): velocity RG (along the limb, outward; star radii/s), pressure R, curl R,
 * divergence R, gas RGB (density, heat, age s). Velocity, pressure and curl keep fixed buffers;
 * the gas ping-pongs, and `field` follows it.
 */
import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  NodeMaterial,
  QuadMesh,
  RedFormat,
  RenderTarget,
  RepeatWrapping,
  RGBAFormat,
  RGFormat,
  Vector4,
  type PixelFormat,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import { Fn, abs, clamp, cos, exp, float, fract, length, min, mix, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Node, TextureNode } from 'three/webgpu';
import { loop, vec4Array, type Vec4Array } from '../../../render/tsl/helpers';
import { vNoise4 } from '../../../render/tsl/volumeNoise';
import { GAS_CELL, GAS_FADE_SHARE, GAS_HEIGHT, GAS_JACOBI, GAS_MAX_STEPS, GAS_NX, GAS_NY, GAS_PREROLL, GAS_STEP } from './domain';
import { VENT_COUNT, VENT_HEIGHT, ventAt } from './vents';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

const TAU = 2 * Math.PI;
/** Velocity damping per step and the clamp on speed (star radii/s). */
const DAMPING = 0.999;
const MAX_SPEED = 0.087;
/** Outward pull on gas: buoyancy per unit heat, minus gravity (star radii/s², scaled by density). */
const BUOYANCY = 0.0056;
const GRAVITY = 0.0042;
/** Vorticity confinement (× cell size) and turbulent forcing (star radii/s²; noise per star radius). */
const CONFINEMENT = 2.8;
const TURBULENCE = 0.0077;
const TURBULENCE_SCALE = 86;
/** Rates at which a vent imposes its velocity (per s) and adds gas (density per s). */
const INJECT_MOMENTUM = 18;
const INJECT_GAS = 7;
/** Heat carried in per unit density; e-folding rates of density and heat (per s). */
const INJECT_HEAT = 1.7;
const DENSITY_DECAY = 0.06;
const HEAT_DECAY = 0.13;
const MAX_DENSITY = 3;
const MAX_HEAT = 4;
/**
 * Age stops counting once gas has all but decayed (e^−0.06·60 ≈ 3 %). Unbounded, it ran to thousands of
 * seconds in empty cells, where half floats step by seconds: the age-driven eddy drift then jumped
 * from cell to cell and streaked the gas.
 */
const MAX_AGE = 60;
/** Extra dissipation rate (per s) at the very top of the grid, ramping in over GAS_FADE_SHARE. */
const TOP_DECAY = 1.5;

function target(format: PixelFormat, name: string): RenderTarget {
  const t = new RenderTarget(GAS_NX, GAS_NY, { type: HalfFloatType, format, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
  t.texture.name = name;
  t.texture.wrapS = RepeatWrapping;
  t.texture.wrapT = ClampToEdgeWrapping;
  return t;
}

function material(name: string, build: () => unknown): NodeMaterial {
  const m = new NodeMaterial();
  m.name = name;
  m.fragmentNode = Fn(build)() as unknown as Node<'vec4'>;
  m.depthTest = false;
  m.depthWrite = false;
  m.toneMapped = false;
  return m;
}

const q = uv() as unknown as V2;
const gx = vec2(1 / GAS_NX, 0);
const gy = vec2(0, 1 / GAS_NY);
/** Height above the limb, radius from the star's centre and position angle of a cell (uv). */
const heightAt = (st: V2): F => st.y.mul(GAS_HEIGHT) as unknown as F;
const radiusAt = (st: V2): F => heightAt(st).add(1) as unknown as F;
const angleAt = (st: V2): F => st.x.sub(0.5).mul(TAU) as unknown as F;
/** Back-traced uv of a cell moving at v (star radii/s) over one step. */
const backTrace = (v: V2, r: F): V2 => q.sub(vec2(v.x.mul(GAS_STEP / TAU).div(r), v.y.mul(GAS_STEP / GAS_HEIGHT))) as unknown as V2;
/** Velocity is held at zero inside the photosphere and fades out at the top of the grid. */
const walls = (st: V2): F => smoothstep(-0.0009, 0.0027, heightAt(st)).mul(smoothstep(0.0, 4 / GAS_NY, float(1).sub(st.y))) as unknown as F;

export class CoronalGas {
  /**
   * The gas state (density, heat, age) after the last step and the one before it, and how far the
   * frame is between them: rendering blends the two, so 30 Hz steps play smoothly at any frame rate
   * (one step behind). The previous state is the other ping-pong buffer, so this costs no copy.
   */
  readonly field: TextureNode;
  readonly previous: TextureNode;
  readonly blend = uniform(1);
  /** Solver time (s, star time). */
  readonly clock = uniform(0);

  private readonly vel: RenderTarget;
  private readonly velNew: RenderTarget;
  private readonly curl: RenderTarget;
  private readonly div: RenderTarget;
  private readonly pressure: [RenderTarget, RenderTarget];
  private readonly gas: [RenderTarget, RenderTarget];
  private readonly vents: Vec4Array;
  private readonly ventVecs: Vector4[];
  private readonly renderer: WebGPURenderer;
  private readonly quad: QuadMesh;
  private readonly passes: {
    clear: NodeMaterial;
    curl: NodeMaterial;
    advect: [NodeMaterial, NodeMaterial];
    divergence: NodeMaterial;
    jacobi: [NodeMaterial, NodeMaterial];
    project: NodeMaterial;
    gas: [NodeMaterial, NodeMaterial];
  };
  /** Which gas buffer holds the current state. */
  private current = 0;
  private time = 0;

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer;
    this.vel = target(RGFormat, 'gas.velocity');
    this.velNew = target(RGFormat, 'gas.velocityAdvected');
    this.curl = target(RedFormat, 'gas.curl');
    this.div = target(RedFormat, 'gas.divergence');
    this.pressure = [target(RedFormat, 'gas.pressureA'), target(RedFormat, 'gas.pressureB')];
    this.gas = [target(RGBAFormat, 'gas.stateA'), target(RGBAFormat, 'gas.stateB')];
    this.field = texture(this.gas[0].texture);
    this.previous = texture(this.gas[1].texture);
    // Per vent: (angle, height, radius, strength) (vx, vy, 0, 0).
    this.ventVecs = Array.from({ length: VENT_COUNT * 2 }, () => new Vector4(0, 0, 0, 0));
    this.vents = vec4Array(this.ventVecs);

    const vel = texture(this.vel.texture);
    const velNew = texture(this.velNew.texture);
    const curl = texture(this.curl.texture);
    const div = texture(this.div.texture);
    const clock = this.clock as unknown as F;

    /**
     * Sum over the vents of fn(gaussian footprint × strength, slot) at cell st: footprints are
     * exp(−2 d²/r²) in star radii, the angle wrapped round the limb.
     */
    const eachVent = (st: V2, fn: (w: F, k: Node<'int'>) => void): void => {
      const psi = angleAt(st);
      const r = radiusAt(st);
      const h = heightAt(st);
      loop('vent', VENT_COUNT, (k) => {
        const a = this.vents.at(k.mul(2));
        const dPsi = fract(psi.sub(a.x).div(TAU).add(0.5)).sub(0.5).mul(TAU);
        const dx = dPsi.mul(r);
        const dy = h.sub(a.y);
        const d2 = dx.mul(dx).add(dy.mul(dy));
        fn(exp(d2.div(a.z.mul(a.z)).mul(-2)).mul(a.w) as unknown as F, k);
      });
    };

    // Curl in the polar metric: ω = (1/r)∂v_r/∂ψ − ∂v_ψ/∂r − v_ψ/r.
    const curlPass = () => {
      const r = radiusAt(q);
      const w = vel
        .sample(q.add(gx))
        .y.sub(vel.sample(q.sub(gx)).y)
        .div(r.mul(2 * GAS_CELL))
        .sub(vel.sample(q.add(gy)).x.sub(vel.sample(q.sub(gy)).x).div(2 * GAS_CELL))
        .sub(vel.sample(q).x.div(r));
      return vec4(w, 0, 0, 1);
    };

    const advectPass = (gasTex: Texture) => () => {
      const state = texture(gasTex).sample(q);
      const r = radiusAt(q).toVar();
      const v = vel.sample(q).xy;
      const adv = vel.sample(backTrace(v, r)).xy.mul(DAMPING).toVar();
      const weight = smoothstep(0.01, 0.25, state.r).toVar();
      // Hot gas is buoyant; dense, cooling gas falls back toward the surface.
      adv.y.addAssign(state.g.mul(BUOYANCY).sub(GRAVITY).mul(weight).mul(GAS_STEP));
      // Vorticity confinement: spin up the eddies the grid would smear out.
      const wc = curl.sample(q).r;
      const grad = vec2(abs(curl.sample(q.add(gx)).r).sub(abs(curl.sample(q.sub(gx)).r)).div(r), abs(curl.sample(q.add(gy)).r).sub(abs(curl.sample(q.sub(gy)).r)));
      const n = grad.div(length(grad).add(1e-4));
      adv.addAssign(vec2(n.y, n.x.negate()).mul(wc).mul(GAS_CELL * CONFINEMENT * GAS_STEP));
      // Turbulent stirring in the plane's own Cartesian coordinates (seamless round the limb).
      const psi = angleAt(q);
      const plane = vec2(cos(psi), sin(psi)).mul(r);
      const turb = vNoise4(vec3(plane.mul(TURBULENCE_SCALE), clock.mul(0.12))).xy.sub(0.5);
      adv.addAssign(turb.mul(TURBULENCE * GAS_STEP).mul(weight));
      eachVent(q, (w, k) => {
        const b = this.vents.at(k.mul(2).add(1));
        adv.assign(mix(adv, b.xy, clamp(w.mul(INJECT_MOMENTUM * GAS_STEP), 0.0, 1.0)));
      });
      return vec4(clamp(adv.mul(walls(q)), -MAX_SPEED, MAX_SPEED), 0, 1);
    };

    // Divergence in the polar metric (∂v_ψ/(r∂ψ) + ∂v_r/∂r + v_r/r), × cell² for the Jacobi solve.
    const divergencePass = () => {
      const r = radiusAt(q);
      const d = velNew
        .sample(q.add(gx))
        .x.sub(velNew.sample(q.sub(gx)).x)
        .div(r.mul(2 * GAS_CELL))
        .add(velNew.sample(q.add(gy)).y.sub(velNew.sample(q.sub(gy)).y).div(2 * GAS_CELL))
        .add(velNew.sample(q).y.div(r));
      return vec4(d.mul(GAS_CELL * GAS_CELL), 0, 0, 1);
    };

    // Jacobi on the polar Laplacian: p_rr + p_r/r + p_ψψ/r² = div.
    const jacobiPass = (from: Texture) => () => {
      const p = texture(from);
      const r = radiusAt(q);
      const k = float(GAS_CELL / 2).div(r);
      const ir2 = float(1).div(r.mul(r));
      const sum = p
        .sample(q.add(gy))
        .r.mul(k.add(1))
        .add(p.sample(q.sub(gy)).r.mul(float(1).sub(k)))
        .add(p.sample(q.add(gx)).r.add(p.sample(q.sub(gx)).r).mul(ir2));
      return vec4(sum.sub(div.sample(q).r).div(ir2.mul(2).add(2)), 0, 0, 1);
    };

    const projectPass = () => {
      const p = texture(this.pressure[0].texture);
      const r = radiusAt(q);
      const grad = vec2(p.sample(q.add(gx)).r.sub(p.sample(q.sub(gx)).r).div(r.mul(2 * GAS_CELL)), p.sample(q.add(gy)).r.sub(p.sample(q.sub(gy)).r).div(2 * GAS_CELL));
      return vec4(velNew.sample(q).xy.sub(grad).mul(walls(q)), 0, 1);
    };

    const gasPass = (from: Texture) => () => {
      const r = radiusAt(q);
      const state = texture(from).sample(backTrace(vel.sample(q).xy, r)).toVar();
      // Gas thins out as it nears the top of the grid instead of meeting an edge.
      const top = smoothstep(1 - GAS_FADE_SHARE, 1.0, q.y);
      const dens = state.r.mul(exp(top.mul(top).mul(-TOP_DECAY * GAS_STEP)).mul(Math.exp(-DENSITY_DECAY * GAS_STEP))).toVar();
      const heat = state.g.mul(Math.exp(-HEAT_DECAY * GAS_STEP)).toVar();
      const age = state.b.add(GAS_STEP).toVar();
      eachVent(q, (w) => {
        const add = w.mul(INJECT_GAS * GAS_STEP);
        dens.addAssign(add);
        heat.addAssign(add.mul(INJECT_HEAT));
        age.assign(mix(age, 0.0, clamp(add, 0.0, 1.0)));
      });
      const keep = walls(q);
      return vec4(min(dens, MAX_DENSITY).mul(keep), min(heat, MAX_HEAT).mul(keep), clamp(age, 0.0, MAX_AGE), 1);
    };

    this.passes = {
      clear: material('Gas.clear', () => vec4(0)),
      curl: material('Gas.curl', curlPass),
      advect: [material('Gas.advectA', advectPass(this.gas[0].texture)), material('Gas.advectB', advectPass(this.gas[1].texture))],
      divergence: material('Gas.divergence', divergencePass),
      jacobi: [material('Gas.jacobiAB', jacobiPass(this.pressure[0].texture)), material('Gas.jacobiBA', jacobiPass(this.pressure[1].texture))],
      project: material('Gas.project', projectPass),
      gas: [material('Gas.stateAB', gasPass(this.gas[0].texture)), material('Gas.stateBA', gasPass(this.gas[1].texture))],
    };
    this.quad = new QuadMesh(this.passes.clear);
  }

  /** Clears the gas and simulates the GAS_PREROLL seconds before star time t0. */
  async preroll(t0: number): Promise<void> {
    this.time = t0 - GAS_PREROLL;
    this.withTargets(() => {
      for (const t of [this.vel, this.velNew, this.curl, this.div, ...this.pressure, ...this.gas]) this.run(this.passes.clear, t);
    });
    this.current = 0;
    this.field.value = this.gas[0].texture;
    const steps = Math.round(GAS_PREROLL / GAS_STEP);
    for (let i = 0; i < steps; i++) {
      this.withTargets(() => this.step());
      // Yield now and then so the loading screen stays alive.
      if (i % 30 === 29) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.time = t0;
    this.blend.value = 1;
  }

  /** Advances the gas toward star time t in fixed steps (at most GAS_MAX_STEPS; a longer stall drops time). */
  update(t: number): void {
    if (t < this.time - 1) this.time = t;
    let steps = 0;
    this.withTargets(() => {
      while (this.time + GAS_STEP <= t && steps < GAS_MAX_STEPS) {
        this.step();
        steps++;
      }
    });
    if (t - this.time > GAS_STEP) this.time = t - GAS_STEP;
    this.blend.value = Math.min(1, Math.max(0, (t - this.time) / GAS_STEP));
  }

  dispose(): void {
    for (const t of [this.vel, this.velNew, this.curl, this.div, ...this.pressure, ...this.gas]) t.dispose();
    for (const m of Object.values(this.passes).flat()) m.dispose();
  }

  private step(): void {
    this.time += GAS_STEP;
    this.clock.value = this.time;
    for (let i = 0; i < VENT_COUNT; i++) {
      const v = ventAt(i, this.time);
      this.ventVecs[i * 2].set(v.angle, VENT_HEIGHT, v.radius, v.strength);
      this.ventVecs[i * 2 + 1].set(v.vx, v.vy, 0, 0);
    }
    const c = this.current;
    const p = this.passes;
    this.run(p.curl, this.curl);
    this.run(p.advect[c], this.velNew);
    this.run(p.divergence, this.div);
    for (let i = 0; i < GAS_JACOBI; i++) this.run(p.jacobi[i & 1], this.pressure[(i + 1) & 1]);
    this.run(p.project, this.vel);
    this.run(p.gas[c], this.gas[1 - c]);
    this.current = 1 - c;
    this.field.value = this.gas[this.current].texture;
    this.previous.value = this.gas[c].texture;
  }

  private run(m: NodeMaterial, out: RenderTarget): void {
    this.quad.material = m;
    this.renderer.setRenderTarget(out);
    this.quad.render(this.renderer);
  }

  /** Every texel of every pass is written, so targets are not cleared; the caller's target is restored. */
  private withTargets(fn: () => void): void {
    const previous = this.renderer.getRenderTarget();
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try {
      fn();
    } finally {
      this.renderer.autoClear = autoClear;
      this.renderer.setRenderTarget(previous);
    }
  }
}
