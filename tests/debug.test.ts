import { describe, expect, it } from 'vitest';
import { isDebugHost, readDebugParams } from '../src/debug/params';

describe('debug modes are local-only', () => {
  it('recognises local hosts', () => {
    for (const h of ['localhost', 'LOCALHOST', 'dyson.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1']) expect(isDebugHost(h)).toBe(true);
  });
  it('rejects deployed hosts, including look-alikes', () => {
    for (const h of ['dyson.example.com', 'localhost.example.com', '127.0.0.1.example.com', '192.168.1.20', '10.0.0.5', '']) expect(isDebugHost(h)).toBe(false);
  });
  it('ignores every parameter on a deployed host', () => {
    const q = '?view=hdr&spot=zenith&time=5&ev=2&sky=material&autostart&manual&noao&profile&probe&fov=30&look=1,2&wobble=3&steady&tm=agx';
    expect(readDebugParams(q, 'dyson.example.com')).toEqual(readDebugParams('', 'localhost'));
    expect(readDebugParams(q, 'localhost').view).toBe('hdr');
  });
});
