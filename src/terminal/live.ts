/**
 * What the terminal's screen shows live (os/screen.ts TerminalLive), read from the world each frame
 * into one reused object: the craft's leg and place, the East Lock's and the West Gate's gates.
 */
import type { World } from '../app/world';
import type { TerminalLive } from './os/screen';

const live: TerminalLive = {
  craft: { phase: 'gap', x: 0, z: 0, visible: false },
  lock: { outer: 0, inner: 0 },
  gate: { outer: 0, inner: 0 },
};

export function terminalLive(world: World): TerminalLive {
  const f = world.vehicles.craft.flight;
  live.craft.phase = f.phase;
  live.craft.x = f.position.x;
  live.craft.z = f.position.z;
  live.craft.visible = f.visible;
  const lock = world.city.lock.airlock;
  live.lock.outer = lock.outer.openness;
  live.lock.inner = lock.inner.openness;
  const gate = world.city.gate.airlock;
  live.gate.outer = gate.outer.openness;
  live.gate.inner = gate.inner.openness;
  return live;
}
