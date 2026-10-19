/**
 * URL debug parameters (development and headless renders; local hosts only, see isDebugHost):
 *   ?view=final|hdr|ao|normal|depth|velocity|aerial|nopost|glare|veil  pipeline stage
 *   ?spot=<viewpoint>                                        fixed camera (see viewpoints.ts)
 *   ?time=<seconds>                                          freeze game time (star rotation, flares)
 *   ?tm=film|agx|aces|neutral                                tone mapper (film = hue-preserving)
 *   ?ev=<number>                                             override the fixed camera exposure (EV)
 *   ?sky=localS|localT|material|noAtmosphere|space   sky composition signal (space: the sky beyond the shell alone)
 *   ?fov=<deg>&look=<yawDeg,pitchDeg>                         review framing (vertical FOV, view direction)
 *   ?profile                                                 GPU timestamp profiling (window.__dyson.gpuMs)
 *   ?noao                                                    disable GTAO
 *   ?probe                                                   lighting probe spheres in front of the spawn
 *   ?autostart                                               skip the Enter click (renders behind no UI)
 *   ?wobble=<deg>                                            periodic yaw sweep (±deg, 37-frame period) for flicker checks
 *   ?steady                                                  with ?wobble: the same amplitude every period (isolates aliasing from TAA motion softening)
 *   ?manual                                                  no animation loop: frames are stepped via __dyson.game.renderFrame
 *   ?gate=closed|outer|inner                                 hold the West Gate's airlock in a state (both shut, outer or inner open)
 *   ?lock=closed|outer|inner|open                            pose the East Lock's gates (for review; the craft drive it in play)
 *   ?vent                                                    lift the Cold Hold's largest relief stack at once (vapour and sound review)
 *   ?craft=<leg>[:s]                                         run the craft's visit forward to a leg (approach, hold, enter, inbound, hover, outbound, depart), s seconds in
 *   ?drive                                                   start in the car, behind it (vehicles review)
 *   ?terminal[=<keys>]                                       start at the West Gate terminal, zoomed in and awake; keys (u d l r e, e.g. "rr" or "drre") are pressed after its boot
 *   ?tat=<s>                                                 with ?terminal: once the keys are pressed, hold the recording playing at s seconds in (stills)
 */
import type { DebugView, ToneMapper } from '../render/pipeline';

export interface DebugParams {
  view: DebugView;
  spot: string | null;
  time: number | null;
  toneMapper: ToneMapper;
  ev: number | null;
  autostart: boolean;
  sky: string | null;
  probe: boolean;
  ao: boolean;
  profile: boolean;
  fov: number | null;
  look: [number, number] | null;
  wobble: number | null;
  steady: boolean;
  manual: boolean;
  gate: 'closed' | 'outer' | 'inner' | null;
  lock: 'closed' | 'outer' | 'inner' | 'open' | null;
  vent: boolean;
  craft: string | null;
  drive: boolean;
  /** Start at the terminal; the keys to press once it has booted (null: not at it). */
  terminal: string | null;
  /** With ?terminal: seconds into the recording to jump to once the keys are pressed. */
  terminalAt: number | null;
}

const VIEWS: DebugView[] = ['final', 'hdr', 'ao', 'normal', 'depth', 'velocity', 'aerial', 'nopost', 'distance', 'glare', 'veil'];

/**
 * Debug modes are a development tool: they work only when the page is served from this machine
 * (localhost, a loopback address or a *.localhost name). On any deployed host every parameter is
 * ignored and the debug hooks (window.__dyson) are not installed.
 */
export function isDebugHost(hostname = window.location.hostname): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function readDebugParams(search = window.location.search, hostname = window.location.hostname): DebugParams {
  const q = new URLSearchParams(isDebugHost(hostname) ? search : '');
  const view = (q.get('view') ?? 'final') as DebugView;
  const tm = q.get('tm');
  const time = q.get('time');
  const ev = q.get('ev');
  return {
    view: VIEWS.includes(view) ? view : 'final',
    spot: q.get('spot'),
    time: time !== null && Number.isFinite(Number(time)) ? Number(time) : null,
    toneMapper: tm === 'agx' || tm === 'neutral' || tm === 'aces' ? tm : 'film',
    ev: ev !== null && Number.isFinite(Number(ev)) ? Number(ev) : null,
    autostart: q.has('autostart'),
    sky: q.get('sky'),
    probe: q.has('probe'),
    ao: !q.has('noao'),
    profile: q.has('profile'),
    fov: q.get('fov') !== null && Number.isFinite(Number(q.get('fov'))) ? Number(q.get('fov')) : null,
    look: q.get('look') ? (q.get('look')!.split(',').map(Number).slice(0, 2) as [number, number]) : null,
    wobble: q.get('wobble') !== null && Number.isFinite(Number(q.get('wobble'))) ? Number(q.get('wobble')) : null,
    steady: q.has('steady'),
    manual: q.has('manual'),
    gate: ((g) => (g === 'closed' || g === 'outer' || g === 'inner' ? g : null))(q.get('gate')),
    lock: ((g) => (g === 'closed' || g === 'outer' || g === 'inner' || g === 'open' ? g : null))(q.get('lock')),
    vent: q.has('vent'),
    craft: q.get('craft'),
    drive: q.has('drive'),
    terminal: q.has('terminal') ? (q.get('terminal') ?? '') : null,
    terminalAt: q.get('tat') !== null && Number.isFinite(Number(q.get('tat'))) ? Number(q.get('tat')) : null,
  };
}
