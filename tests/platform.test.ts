import { describe, expect, it } from 'vitest';
import { checkPlatform } from '../src/core/platform';

const nav = (brands: string[], mobile: boolean, gpu: boolean, ua = 'Mozilla/5.0'): Navigator =>
  ({ userAgent: ua, userAgentData: { brands: brands.map((brand) => ({ brand, version: '150' })), mobile }, ...(gpu ? { gpu: {} } : {}) }) as unknown as Navigator;

describe('platform gate', () => {
  it('accepts desktop Chromium with WebGPU', () => {
    expect(checkPlatform(nav(['Chromium', 'Google Chrome', 'Not?A_Brand'], false, true)).ok).toBe(true);
  });
  it('refuses non-Chromium browsers even with WebGPU', () => {
    const r = checkPlatform({ userAgent: 'Firefox', gpu: {} } as unknown as Navigator);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Chromium/);
  });
  it('refuses mobile Chromium', () => {
    expect(checkPlatform(nav(['Chromium'], true, true)).reason).toMatch(/desktop/i);
  });
  it('refuses Chromium without WebGPU', () => {
    expect(checkPlatform(nav(['Chromium'], false, false)).reason).toMatch(/WebGPU/);
  });
});
