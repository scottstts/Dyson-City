/**
 * Platform gate. Runs before any engine code is loaded: Chromium desktop with WebGPU only.
 */

export interface PlatformReport {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly brand: string;
  readonly mobile: boolean;
  readonly webgpu: boolean;
}

interface UADataLike {
  readonly brands?: ReadonlyArray<{ brand: string; version: string }>;
  readonly mobile?: boolean;
}

export function checkPlatform(nav: Navigator = navigator): PlatformReport {
  const uaData = (nav as Navigator & { userAgentData?: UADataLike }).userAgentData;
  const brands = uaData?.brands ?? [];
  const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand));
  const brand = brands.filter((b) => !/Not.?A.?Brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`).join(', ') || 'unknown';
  const mobile = uaData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(nav.userAgent);
  const webgpu = 'gpu' in nav && nav.gpu !== undefined;

  let reason: string | null = null;
  if (!chromium) reason = 'Dyson runs only in Chromium-based desktop browsers (Chrome, Edge, Arc, Brave…).';
  else if (mobile) reason = 'Dyson is a desktop experience. Mobile devices are not supported.';
  else if (!webgpu) reason = 'WebGPU is not available in this browser. Update Chrome or enable hardware acceleration.';

  return { ok: reason === null, reason, brand, mobile, webgpu };
}
