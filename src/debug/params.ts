/**
 * URL debug parameters (development and headless renders):
 *   ?view=final|hdr|ao|normal|depth|velocity|aerial|nopost|glare   pipeline stage
 *   ?spot=<viewpoint>                                        fixed camera (see viewpoints.ts)
 *   ?time=<seconds>                                          freeze game time (star rotation, flares)
 *   ?tm=film|agx|aces|neutral                                tone mapper (film = hue-preserving)
 *   ?ev=<number>                                             override the fixed camera exposure (EV)
 *   ?sky=localS|localT|material|noAtmosphere   sky composition signal
 *   ?fov=<deg>&look=<yawDeg,pitchDeg>                         review framing (vertical FOV, view direction)
 *   ?profile                                                 GPU timestamp profiling (window.__dyson.gpuMs)
 *   ?noao                                                    disable GTAO
 *   ?probe                                                   lighting probe spheres in front of the spawn
 *   ?autostart                                               skip the Enter click (renders behind no UI)
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
}

const VIEWS: DebugView[] = ['final', 'hdr', 'ao', 'normal', 'depth', 'velocity', 'aerial', 'nopost', 'distance', 'glare'];

export function readDebugParams(search = window.location.search): DebugParams {
  const q = new URLSearchParams(search);
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
  };
}
