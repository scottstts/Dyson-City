/**
 * The crew (docs/crew.md): the robots that run the compound and keep the garden. Built at boot
 * after the field, the estate and the star-shade's raster; updated every frame after the player and
 * the vehicles.
 *
 *  - Plans (plan/): every ground robot's precinct beat, the Linewalkers' stretches, the decks, the
 *    estate's jobs, the fliers' sorties; fixtures (cradles, pads, sockets) placed with them.
 *  - Agents (agents/) drive each robot's motion; every robot of a type is one instance in its
 *    type's batch (rig.ts): one draw per segment and slot, whatever the count.
 *  - They share the world: a robot holds for whatever is in its way (the player, the car, another
 *    robot) and, held long, routes round it. Near the player, each ground robot is a moving outline
 *    in the walker's and the car's walls. The nearest cast their soft noon shade on the ground.
 *  - Sound reads their state (sound.ts); nothing here plays anything.
 */
import { Group, Matrix4, Mesh, Vector3, type Material } from 'three/webgpu';
import { emitParts, type Vec3 } from '../geometry/polyMesh';
import { createCrewMaterials, CREW_SLOTS, type CrewLook } from './materials';
import { LodBatch, RigBatch, type PartDef, type RigDef } from './rig';
import { withDetail } from './kit/shapes';
import { buildHandRig } from './models/hand';
import { buildLinewalkerRig } from './models/linewalker';
import { buildRiggerRig } from './models/rigger';
import { buildDrayRig, DRAY } from './models/dray';
import { buildFerryRig, buildSpotterRig } from './models/drones';
import { buildMower, buildSlate, buildTrimmer, MOWER } from './models/props';
import { findPath, navGrid, type Disc, type NavGrid, type P2 } from './nav';
import { CLEARANCE, fieldOutMask, fieldPlan } from './plan/field';
import { airPlan, type HeightMap } from './plan/air';
import { cordonDeck, galleryDeck, lineStretches, supplyLine } from './plan/lines';
import { estateGround, estateNav, estatePlan } from './plan/estate';
import { HandAgent, type Surroundings } from './agents/hand';
import { DrayAgent, drayLegs, LinewalkerAgent, RiggerAgent } from './agents/machines';
import { DroneAgent } from './agents/drone';
import { cradleParts, FIXTURE_R, padParts, socketParts } from './fixtures';
import { FIELD_Y } from '../field/layout';
import type { WalkMesh } from '../player/walkMesh';
import type { CollisionWorld } from '../player/collision';
import { createVehicleShade, type ShadeBox, type VehicleShade } from '../vehicles/shade';
import { ESTATE_BOUNDS } from '../estate/layout';
import { CrewSound } from './sound';

/** The field's body-height occupancy raster (field/walk.ts): 0.5 m cells from −512. */
export const FIELD_OCC = { origin: -512, cell: 0.5, n: 2048 } as const;

export interface CrewInputs {
  occupancy: Uint8Array;
  heights: HeightMap;
  estateWalk: WalkMesh;
  /** The city's walls (the walker's and the car's): fixtures join them; robots' outlines come and go. */
  walls: CollisionWorld;
}

export interface CrewFrame {
  /** The walker's feet (null while driving). */
  feet: Vector3 | null;
  /** The car's footprint while it moves (centre, heading, half-sizes), or null. */
  car: { x: number; z: number; heading: number; hl: number; hw: number } | null;
  /** Seconds until the craft next enters the Dome (0 while it is in). */
  craftWindow: number;
  /** The eye (which robots shade the ground near it). */
  eye: Vector3;
}

type Ground = HandAgent | RiggerAgent | DrayAgent;

/** A robot's body in plan for spacing, walls and shade: radius, or a box. */
function bodyOf(a: Ground): { r: number } {
  return a instanceof HandAgent ? { r: 0.34 } : a instanceof RiggerAgent ? { r: 1.15 } : { r: 1.4 };
}

/** The far level's tessellation, and the distances (m) within which each kind draws at full detail. */
const FAR_DETAIL = 0.3;
const LOD = { hand: 30, small: 30, large: 55 } as const;

/** The crew's shade: boxes for the robots nearest the eye. */
export const CREW_SHADE_BOXES = 12;

export class Crew {
  readonly group = new Group();
  readonly hands: HandAgent[] = [];
  readonly riggers: RiggerAgent[] = [];
  readonly drays: DrayAgent[] = [];
  readonly linewalkers: LinewalkerAgent[] = [];
  readonly drones: DroneAgent[] = [];
  readonly shade: VehicleShade = createVehicleShade(CREW_SHADE_BOXES);
  readonly fixtures: Mesh;
  /** The fixtures' footprints (plan, radius) and the cradles' and pads' tops, for the shade's raster. */
  readonly fixtureMeshes: Mesh[];
  /** Where the fixtures stand: the cradles' seats, the pads' tops, the sockets' centres. */
  readonly fixturesAt: { cradles: Vec3[]; pads: Vec3[]; sockets: Vec3[] };
  private readonly batches: LodBatch[] = [];
  private readonly batch: Record<string, LodBatch> = {};
  private readonly walls: CollisionWorld;
  private readonly held = new Map<object, number>();
  private readonly ground: Ground[] = [];
  readonly triangles: number;
  readonly fieldNav: NavGrid;
  readonly estateNav: NavGrid;
  /** What its sound reads: every loop's state and this frame's footfalls and latches. */
  readonly sound: CrewSound;
  private materials: Material[];

  constructor(inp: CrewInputs) {
    const t0 = performance.now();
    this.group.name = 'Crew';
    this.walls = inp.walls;
    this.materials = createCrewMaterials();
    const groundY = () => FIELD_Y;
    // Navigation: the field's occupancy and where the crew never goes.
    const occ0 = inp.occupancy;
    const out = fieldOutMask(FIELD_OCC.origin, FIELD_OCC.origin, FIELD_OCC.cell, FIELD_OCC.n, FIELD_OCC.n);
    let nav = navGrid(occ0, FIELD_OCC.origin, FIELD_OCC.origin, FIELD_OCC.cell, FIELD_OCC.n, FIELD_OCC.n, out);
    const air = airPlan(nav, inp.heights);
    // The fliers' fixtures stand on the ground: the ground crew keeps clear of them.
    const occ = occ0.slice();
    const mark = (x: number, z: number, r: number) => {
      const c = FIELD_OCC.cell;
      for (let j = Math.floor((z - r - FIELD_OCC.origin) / c); j <= Math.floor((z + r - FIELD_OCC.origin) / c); j++) {
        for (let i = Math.floor((x - r - FIELD_OCC.origin) / c); i <= Math.floor((x + r - FIELD_OCC.origin) / c); i++) {
          const cx = FIELD_OCC.origin + (i + 0.5) * c;
          const cz = FIELD_OCC.origin + (j + 0.5) * c;
          if (Math.hypot(cx - x, cz - z) <= r + c * 0.5) occ[j * FIELD_OCC.n + i] = 1;
        }
      }
    };
    for (const c of air.cradles) mark(c[0], c[2], FIXTURE_R.cradle);
    for (const p of air.pads) mark(p[0], p[2], FIXTURE_R.pad + 0.6);
    nav = navGrid(occ, FIELD_OCC.origin, FIELD_OCC.origin, FIELD_OCC.cell, FIELD_OCC.n, FIELD_OCC.n, out);
    this.fieldNav = nav;
    const plan = fieldPlan(nav);
    // Rigs and their agents.
    const rigs = { hand: buildHandRig(), linewalker: buildLinewalkerRig(), rigger: buildRiggerRig(), dray: buildDrayRig(), spotter: buildSpotterRig(), ferry: buildFerryRig() };
    let seed = 9001;
    for (const b of plan.hands) this.hands.push(new HandAgent(rigs.hand, { kind: 'field', beat: b }, groundY, seed++));
    for (const [name, angle] of [['cordon-north', -2.15], ['cordon-south', 1.05]] as const) {
      const d = cordonDeck(name, angle);
      this.hands.push(new HandAgent(rigs.hand, { kind: 'deck', deck: d }, () => d.y, seed++));
    }
    for (const c of ['stills', 'reckoner']) {
      const d = galleryDeck(c);
      this.hands.push(new HandAgent(rigs.hand, { kind: 'deck', deck: d }, () => d.y, seed++));
    }
    // The estate's three.
    const enav = estateNav(inp.estateWalk);
    this.estateNav = enav;
    const eplan = estatePlan(enav);
    const eground = estateGround();
    const ebox: [number, number, number, number] = [ESTATE_BOUNDS[0], ESTATE_BOUNDS[2], ESTATE_BOUNDS[1], ESTATE_BOUNDS[3]];
    if (eplan.mow.passes.length > 1) this.hands.push(new HandAgent(rigs.hand, { kind: 'mow', plan: eplan.mow }, eground, seed++));
    // The hedger: the runs it can walk between, in a loop.
    const keep = eplan.hedge.filter((r, _k, all) => all.length < 2 || all.some((q) => q !== r && findPath(enav, r.walk[r.walk.length - 1], q.walk[0], 0.45, ebox)));
    const links: P2[][] = [];
    let linked = true;
    for (let k = 0; k < keep.length && linked; k++) {
      const p = findPath(enav, keep[k].walk[keep[k].walk.length - 1], keep[(k + 1) % keep.length].walk[0], 0.45, ebox);
      if (p) links.push(p);
      else linked = false;
    }
    if (keep.length > 1 && linked) this.hands.push(new HandAgent(rigs.hand, { kind: 'hedge', runs: keep, links }, eground, seed++));
    if (eplan.garden.length > 1) this.hands.push(new HandAgent(rigs.hand, { kind: 'garden', posts: eplan.garden, legs: eplan.gardenLegs }, eground, seed++));
    for (const b of plan.riggers) this.riggers.push(new RiggerAgent(rigs.rigger, b, groundY, seed++));
    const sockets: Vec3[] = [];
    for (const b of plan.drays) {
      const legs = drayLegs(nav, b);
      if (!legs) continue;
      this.drays.push(new DrayAgent(rigs.dray, b, legs, groundY, seed++));
      for (const p of b.posts) {
        // The socket sits under the probe when the dray stands over its post.
        const s = Math.sin(p.face);
        const c = Math.cos(p.face);
        sockets.push([p.x + s * DRAY.probe.z, FIELD_Y, p.z + c * DRAY.probe.z]);
      }
    }
    const line = supplyLine();
    for (const st of lineStretches(line, 16)) this.linewalkers.push(new LinewalkerAgent(rigs.linewalker, line, st, seed++));
    for (const s of air.spotters) this.drones.push(new DroneAgent(rigs.spotter, s, seed++));
    for (const s of air.ferries) this.drones.push(new DroneAgent(rigs.ferry, s, seed++));
    this.ground.push(...this.hands, ...this.riggers, ...this.drays);
    this.sound = new CrewSound(this.hands, this.riggers, this.drays, this.linewalkers, this.drones);
    // Batches: per type, near and far levels; the Hands' props likewise, one per prop held.
    const add = (name: string, build: () => RigDef, n: number, near: number, built?: RigDef) => {
      if (!n) return;
      const nb = new RigBatch(built ?? build(), n, this.materials, CREW_SLOTS);
      const fb = new RigBatch(withDetail(FAR_DETAIL, build), n, this.materials, CREW_SLOTS);
      const b = new LodBatch(nb, fb, near);
      this.batch[name] = b;
      this.batches.push(b);
      for (const m of b.list) this.group.add(m);
    };
    add('hand', buildHandRig, this.hands.length, LOD.hand, rigs.hand);
    add('linewalker', buildLinewalkerRig, this.linewalkers.length, LOD.small, rigs.linewalker);
    add('rigger', buildRiggerRig, this.riggers.length, LOD.large, rigs.rigger);
    add('dray', buildDrayRig, this.drays.length, LOD.large, rigs.dray);
    add('spotter', buildSpotterRig, this.drones.filter((d) => d.sortie.kind === 'spotter').length, LOD.small, rigs.spotter);
    add('ferry', buildFerryRig, this.drones.filter((d) => d.sortie.kind === 'ferry').length, LOD.large, rigs.ferry);
    add('slate', buildSlate, this.hands.filter((h) => h.slate).length, LOD.small);
    add('mower', buildMower, this.hands.filter((h) => h.mower).length, LOD.hand);
    add('trimmer', buildTrimmer, this.hands.filter((h) => h.trimmer).length, LOD.hand);
    // Fixtures: one static mesh; their solid footprints join the walls.
    const parts: PartDef[] = [];
    air.cradles.forEach((c, k) => parts.push(...cradleParts(c, k)));
    air.pads.forEach((p, k) => parts.push(...padParts(p, k)));
    sockets.forEach((s, k) => parts.push(...socketParts(s, k)));
    this.fixtures = new Mesh(emitParts(parts.map((p) => p.mesh), { slots: CREW_SLOTS }), this.materials);
    this.fixtures.name = 'Crew.fixtures';
    this.fixtures.matrixAutoUpdate = false;
    this.group.add(this.fixtures);
    this.fixtureMeshes = [this.fixtures];
    this.fixturesAt = { cradles: air.cradles, pads: air.pads, sockets };
    const ring = (x: number, z: number, r: number) => Array.from({ length: 12 }, (_, i) => [x + Math.cos((i / 12) * Math.PI * 2) * r, z + Math.sin((i / 12) * Math.PI * 2) * r] as [number, number]);
    for (const c of air.cradles) inp.walls.addPolygon(ring(c[0], c[2], FIXTURE_R.cradle));
    for (const p of air.pads) inp.walls.addPolygon(ring(p[0], p[2], FIXTURE_R.pad));
    this.triangles = this.batches.reduce((t, b) => t + b.near.triangles, 0);
    // Posed once (agents pose as they step): held review time (?time) never steps them.
    this.step(1 / 60, Infinity);
    this.sound.begin();
    this.write(new Vector3(-440, FIELD_Y + 1.6, 0));
    const per = Object.entries(this.batch).map(([n, b]) => `${n} ${(b.near.triangles / b.near.count / 1000).toFixed(1)}k/${(b.far.triangles / b.far.count / 1000).toFixed(1)}k`).join(', ');
    console.info(`[Dyson] crew: ${this.hands.length} Hands, ${this.riggers.length} Riggers, ${this.drays.length} Drays, ${this.linewalkers.length} Linewalkers, ${air.spotters.length} Spotters, ${air.ferries.length} Ferries; tris near/far each: ${per}; ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /** Every drawn mesh (the house's indoor culling hides them indoors). */
  get meshes(): Mesh[] {
    return [...this.batches.flatMap((b) => b.list), this.fixtures];
  }

  setLook(look: CrewLook): void {
    this.materials = createCrewMaterials(look);
    for (const b of this.batches) b.setMaterials(this.materials);
    this.fixtures.material = this.materials;
  }

  private frame: CrewFrame | null = null;

  /** What a robot sees of the world it shares. */
  private readonly world: Surroundings = {
    person: null,
    blocked: (self, x, z, h, r) => {
      const f = this.frame;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      let best = Infinity;
      const test = (ox: number, oz: number, or: number) => {
        const dx = ox - x;
        const dz = oz - z;
        const along = dx * fx + dz * fz;
        const across = Math.abs(dx * fz - dz * fx);
        if (along < -r || along > 8 || across > r + or + 0.2) return;
        best = Math.min(best, Math.max(0, along - or));
      };
      if (f?.feet) test(f.feet.x, f.feet.z, 0.35);
      if (f?.car) test(f.car.x, f.car.z, Math.hypot(f.car.hl, f.car.hw));
      for (const g of this.ground) if (g !== self && Math.abs(g.x - x) < 10 && Math.abs(g.z - z) < 10) test(g.x, g.z, bodyOf(g).r);
      return best;
    },
  };

  private readonly person = new Vector3();

  /** Per frame, after the player and the vehicles (dt 0: held where they are, for review). */
  update(dt: number, f: CrewFrame): void {
    this.frame = f;
    this.world.person = f.feet ? this.person.set(f.feet.x, f.feet.y + 1.6, f.feet.z) : null;
    this.sound.begin();
    if (dt > 0) this.step(dt, f.craftWindow);
    this.sound.refresh();
    this.write(f.eye);
    this.outlines(f);
    this.shadeNear(f.eye);
  }

  private step(dt: number, craftWindow: number): void {
    for (const a of this.ground) {
      const before = a.follow.s;
      if (a instanceof DrayAgent) a.update(dt, this.world);
      else a.update(dt, this.world);
      this.detour(a, dt, a.follow.s - before);
    }
    for (const l of this.linewalkers) l.update(dt);
    for (const d of this.drones) d.update(dt, craftWindow);
  }

  /** Review: runs every robot `seconds` forward, alone in the world (nobody about, the craft away). */
  fastForward(seconds: number, craftWindow: number): void {
    this.frame = null;
    this.world.person = null;
    const dt = 1 / 30;
    for (let t = 0; t < seconds; t += dt) {
      this.sound.begin();
      this.step(dt, craftWindow - t);
    }
    this.sound.refresh();
  }

  /**
   * Held long by something in its way (it made no progress while it should be walking), a ground
   * robot routes round it: a new path to the same place, keeping a disc round the obstacle clear.
   */
  private detour(a: Ground, dt: number, progress: number): void {
    const moving = a.follow.length - a.follow.s > 0.5 && progress < 1e-4;
    const t = moving ? (this.held.get(a) ?? 0) + dt : 0;
    this.held.set(a, t);
    if (t < 3.5 || a instanceof DrayAgent) return;
    this.held.set(a, 0);
    const r = a.follow.root;
    const f = this.frame;
    const discs: Disc[] = [];
    const me = bodyOf(a).r;
    if (f?.feet && Math.hypot(f.feet.x - r.x, f.feet.z - r.z) < 6) discs.push({ x: f.feet.x, z: f.feet.z, r: me + 0.9 });
    for (const g of this.ground) if (g !== a && Math.hypot(g.x - r.x, g.z - r.z) < 6) discs.push({ x: g.x, z: g.z, r: me + bodyOf(g).r + 0.5 });
    if (!discs.length) return;
    const end = a.follow.pts[a.follow.pts.length - 1];
    const estate = a instanceof HandAgent && (a.job.kind === 'mow' || a.job.kind === 'hedge' || a.job.kind === 'garden');
    const nav = estate ? this.estateNav : this.fieldNav;
    const c = a instanceof HandAgent ? CLEARANCE.hand : CLEARANCE.rigger;
    const box: [number, number, number, number] = [r.x - 40, r.x + 40, r.z - 40, r.z + 40];
    const p = findPath(nav, [r.x, r.z], end, c, box, discs);
    if (p && p.length > 1) a.follow.set(p);
  }

  private readonly tmp = new Matrix4();

  /** Writes every robot's segments (and its props) into its batch, near or far from the eye. */
  private write(eye: Vector3): void {
    const B = this.batch;
    for (const b of this.batches) b.begin();
    const d = (x: number, y: number, z: number) => Math.hypot(x - eye.x, y - eye.y, z - eye.z);
    for (const h of this.hands) {
      const r = h.follow.root;
      const dist = d(r.x, h.motion.world[0].elements[13], r.z);
      B.hand?.put(h.motion.world, dist);
      if (h.slate) B.slate?.put([h.slate], dist);
      if (h.mower) B.mower?.put(this.mowerWorld(h), dist);
      if (h.trimmer) B.trimmer?.put([h.trimmer], dist);
    }
    for (const r of this.riggers) B.rigger?.put(r.motion.world, d(r.x, FIELD_Y, r.z));
    for (const r of this.drays) B.dray?.put(r.world, d(r.x, FIELD_Y, r.z));
    for (const l of this.linewalkers) {
      const e = l.world[0].elements;
      B.linewalker?.put(l.world, d(e[12], e[13], e[14]));
    }
    for (const r of this.drones) B[r.sortie.kind]?.put(r.world, d(r.pos.x, r.pos.y, r.pos.z));
    for (const b of this.batches) b.commit();
  }

  /** The mower's segments: its deck, the wheels and roller turning by the distance rolled. */
  private readonly mowerMats = [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()];
  private readonly spin = new Matrix4();
  private mowerWorld(h: HandAgent): Matrix4[] {
    const [deck, wl, wr, roller] = this.mowerMats;
    deck.copy(h.mower!);
    const wheel = (out: Matrix4, x: number, y: number, z: number, r: number) => out.copy(deck).multiply(this.tmp.makeTranslation(x, y, z)).multiply(this.spin.makeRotationX(h.rolled / r));
    wheel(wl, MOWER.cut / 2 + 0.06, MOWER.wheelR, MOWER.wheelZ, MOWER.wheelR);
    wheel(wr, -(MOWER.cut / 2 + 0.06), MOWER.wheelR, MOWER.wheelZ, MOWER.wheelR);
    wheel(roller, 0, MOWER.rollerR, 0, MOWER.rollerR);
    return this.mowerMats;
  }

  /** Each ground robot's wall tag, whether it is in the walls now, and its outline's points. */
  private outline: { tag: string; live: boolean; pts: [number, number][] }[] = [];

  /** Near the player, each ground robot is a moving outline in the walls (the walker's and the car's). */
  private outlines(f: CrewFrame): void {
    if (this.outline.length !== this.ground.length) {
      this.outline = this.ground.map((g, k) => ({ tag: `crew:${k}`, live: false, pts: Array.from({ length: g instanceof DrayAgent ? 4 : 8 }, () => [0, 0] as [number, number]) }));
    }
    const cx = f.feet?.x ?? f.car?.x;
    const cz = f.feet?.z ?? f.car?.z;
    for (let k = 0; k < this.ground.length; k++) {
      const g = this.ground[k];
      const o = this.outline[k];
      const near = cx !== undefined && cz !== undefined && Math.hypot(g.x - cx, g.z - cz) <= 30;
      if (!near) {
        if (o.live) this.walls.setDynamic(o.tag, null);
        o.live = false;
        continue;
      }
      const r = g.follow.root;
      if (g instanceof DrayAgent) {
        // Its deck's plan, as an oriented box.
        const s = Math.sin(r.heading);
        const c = Math.cos(r.heading);
        const hw = DRAY.deck.hx;
        const hl = DRAY.deck.hz;
        for (let i = 0; i < 4; i++) {
          const u = i === 1 || i === 2 ? hw : -hw;
          const v = i >= 2 ? hl : -hl;
          o.pts[i][0] = r.x + u * c + v * s;
          o.pts[i][1] = r.z - u * s + v * c;
        }
      } else {
        const rr = g instanceof RiggerAgent ? 0.9 : 0.28;
        for (let i = 0; i < 8; i++) {
          o.pts[i][0] = r.x + Math.cos((i / 8) * Math.PI * 2) * rr;
          o.pts[i][1] = r.z + Math.sin((i / 8) * Math.PI * 2) * rr;
        }
      }
      this.walls.setDynamic(o.tag, o.pts);
      o.live = true;
    }
  }

  private readonly boxes: ShadeBox[] = [];
  /** Candidate boxes (pooled; `used` of them this frame). */
  private readonly cand: { d: number; box: ShadeBox }[] = [];

  /** The noon shade under the robots nearest the eye. */
  private shadeNear(eye: Vector3): void {
    const cand = this.cand;
    let used = 0;
    const push = (x: number, z: number, heading: number, a: number, b: number, h: number, opacity: number) => {
      const d = Math.hypot(x - eye.x, z - eye.z);
      if (d >= 80) return;
      if (used === cand.length) cand.push({ d: 0, box: { x: 0, z: 0, yaw: 0, a: 0, b: 0, h: 0, opacity: 0 } });
      const c = cand[used++];
      const box = c.box;
      c.d = d;
      box.x = x;
      box.z = z;
      box.yaw = heading;
      box.a = a;
      box.b = b;
      box.h = h;
      box.opacity = opacity;
    };
    for (const h of this.hands) {
      const r = h.follow.root;
      // Only where it stands on the platform or the terrace (not up on a deck).
      if (h.job.kind === 'deck') continue;
      push(r.x, r.z, r.heading, 0.2, 0.13, 0.85, 0.8);
      if (h.mower) {
        const e = h.mower.elements;
        push(e[12], e[14], r.heading, 0.3, 0.3, 0.2, 0.9);
      }
    }
    for (const g of this.riggers) push(g.x, g.z, g.follow.root.heading, 0.34, 0.8, 0.97, 0.95);
    for (const g of this.drays) push(g.x, g.z, g.follow.root.heading, DRAY.deck.hx, DRAY.deck.hz, 0.73, 1);
    for (const d of this.drones) {
      if (d.sortie.kind !== 'ferry' || d.pos.y > FIELD_Y + 12) continue;
      push(d.pos.x, d.pos.z, d.heading, 0.95, 0.8, d.pos.y - FIELD_Y, 0.75);
    }
    // The nearest: a partial selection (the pool's tail beyond `used` is stale).
    this.boxes.length = 0;
    for (let k = 0; k < Math.min(CREW_SHADE_BOXES, used); k++) {
      let m = k;
      for (let j = k + 1; j < used; j++) if (cand[j].d < cand[m].d) m = j;
      [cand[k], cand[m]] = [cand[m], cand[k]];
      this.boxes.push(cand[k].box);
    }
    this.shade.set(this.boxes);
  }
}
