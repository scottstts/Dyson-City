import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { OVERRIDES } from '../tools/cinematic/overrides.mjs';

describe('cinematic capture overrides (tools/cinematic)', () => {
  it('every substitution still matches its source exactly once', () => {
    for (const o of OVERRIDES) {
      const src = fs.readFileSync(new URL(`../${o.file}`, import.meta.url)).toString('utf8');
      expect(src.split(o.find).length - 1, `${o.file}: ${o.find}`).toBe(1);
    }
  });
});
