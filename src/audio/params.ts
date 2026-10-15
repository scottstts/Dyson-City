/**
 * Per-frame AudioParam control. Each frame sets targets with setTargetAtTime; repeating an
 * unchanged target is skipped so steady parameters add no automation events.
 */
const last = new WeakMap<AudioParam, number>();

/** Glides `param` toward `value` from time t with time constant tc (0: jump). */
export function glide(param: AudioParam, value: number, t: number, tc: number): void {
  const prev = last.get(param);
  if (prev !== undefined && Math.abs(prev - value) <= Math.abs(value) * 1e-4 + 1e-7) return;
  last.set(param, value);
  if (tc <= 0) param.setValueAtTime(value, t);
  else param.setTargetAtTime(value, t, tc);
}
