import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REGIONS, region } from '../src/data/regions.js';

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

describe('region table', () => {
  it('is the probe table, copied verbatim', () => {
    // The probe labels requests only with these codes; a code missing here
    // would be dropped from the map and the origins table.
    expect(read('../src/data/regions.json')).toEqual(read('../../probe/src/mars_probe/regions.json'));
  });

  it('has names that fit the origins column', () => {
    for (const [code, [name, lat, lon]] of Object.entries(REGIONS)) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect(name).toMatch(/^[A-Z0-9 ]{1,10}$/);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
    expect(region('fra')).toEqual({ code: 'FRA', name: 'FRANKFURT', lat: 50, lon: 8.6 });
    expect(region('XYZ')).toBeNull();
  });
});
