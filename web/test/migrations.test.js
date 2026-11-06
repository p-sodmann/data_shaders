import { describe, expect, it } from 'vitest';
import { migrate, legacyDoc } from '../src/config/migrations.js';
import { prepare } from '../src/config/load.js';
import { DEFAULT_PAGES } from '../src/config/presets.js';

const fromUrl = (search) => prepare(legacyDoc(new URLSearchParams(search)));

describe('v0 migration (legacy URL parameters)', () => {
  it('maps ?source=&station=&hosts= to one polling station', () => {
    const doc = fromUrl('?source=/telemetry.json&station=edge-eu-2&hosts=48');
    expect(doc.version).toBe(1);
    expect(doc.stations).toEqual([{ id: 'main', name: 'EDGE-EU-2', source: { kind: 'poll', url: '/telemetry.json', hosts: 48 } }]);
    expect(doc.pages).toEqual(DEFAULT_PAGES);
  });

  it('maps ?speed= and ?hosts= to a sim station with the old default name', () => {
    const doc = fromUrl('?speed=10&hosts=12');
    expect(doc.stations).toEqual([{ id: 'main', name: 'INFERENCE-01', source: { kind: 'sim', hosts: 12, speed: 10 } }]);
  });

  it('treats ?source=sim as the simulator and ignores junk numbers like the old parser', () => {
    const doc = fromUrl('?source=sim&hosts=-3&speed=abc&station=x');
    expect(doc.stations[0]).toEqual({ id: 'main', name: 'X', source: { kind: 'sim', hosts: 32 } });
  });

  it('is not used when no legacy parameter is present', () => {
    expect(legacyDoc(new URLSearchParams('?fps=30&page=2'))).toBeNull();
  });

  it('migrates a v0 JSON document with its own pages and device', () => {
    const pages = [{ id: 'one', name: 'One', panels: [] }];
    const doc = prepare({ station: 'lab', device: { finish: 'ivory' }, pages });
    expect(doc.stations[0].name).toBe('LAB');
    expect(doc.device.finish).toBe('ivory');
    expect(doc.pages).toEqual(pages);
  });

  it('leaves current documents alone and refuses newer or odd versions', () => {
    const v1 = { version: 1, stations: [], pages: [] };
    expect(migrate(v1)).toBe(v1);
    expect(() => migrate({ version: 9 })).toThrow(/newer/);
    expect(() => migrate({ version: 'one' })).toThrow(/unknown document version/);
    expect(() => migrate([])).toThrow(/JSON object/);
  });
});
