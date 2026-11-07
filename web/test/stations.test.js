import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addStandardPages } from '../src/config/edit.js';
import { defaultDoc, prepare } from '../src/config/load.js';
import { createDocStore } from '../src/config/store.js';
import {
  addStation,
  cartridgeName,
  cartridgeText,
  mergeDocs,
  patchStation,
  promStation,
  readCartridge,
  removeStation,
  setPrometheusUrl,
  stationUsage,
  unclaimed,
  updateStation,
} from '../src/config/stations.js';
import { createPromClient } from '../src/data/prometheus/client.js';
import { readouts, stationValues } from '../src/data/prometheus/stations.js';

const FX = new URL('../src/data/prometheus/__fixtures__/', import.meta.url);
const fx = (name) => JSON.parse(readFileSync(new URL(name, FX), 'utf8'));

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// the built-in document plus the demo's `api` station with its standard pages
const withApi = () => prepare(addStandardPages(addStation(prepare(defaultDoc()), promStation(prepare(defaultDoc()), 'api')), 'api'));

describe('station edits', () => {
  it('makes a Prometheus station from a label value', () => {
    const doc = prepare(defaultDoc());
    expect(promStation(doc, 'api')).toEqual({ id: 'api', name: 'API-01', source: { kind: 'prometheus', station: 'api' } });
    // an id that is taken gets the next free one; the name stays the value's
    const taken = prepare({ ...doc, stations: [...doc.stations, { id: 'api', name: 'X', source: { kind: 'sim' } }] });
    expect(promStation(taken, 'api').id).toBe('api-2');
    expect(promStation(doc, 'a-very-long-station-label-value').name).toHaveLength(24);
    expect(unclaimed(withApi(), ['api', 'search'])).toEqual(['search']);
  });

  it('patches a station: undefined and emptied overrides fall back to the defaults', () => {
    const s = { id: 'a', name: 'A', source: { kind: 'sim' }, thresh: { warn: 10 } };
    expect(patchStation(s, { thresh: { warn: 10, crit: 20 } }).thresh).toEqual({ warn: 10, crit: 20 });
    expect(patchStation(s, { thresh: {} })).not.toHaveProperty('thresh');
    expect(patchStation(s, { stages: [] })).not.toHaveProperty('stages');
    expect(patchStation(s, { home: undefined })).toEqual({ id: 'a', name: 'A', source: { kind: 'sim' }, thresh: { warn: 10 } });
    const doc = updateStation(withApi(), 'api', { thresh: { warn: 40 } });
    expect(prepare(doc).stations[1].thresh).toEqual({ warn: 40 });
    expect(() => updateStation(doc, 'nope', {})).toThrow(/no station/);
  });

  it('removes a station with its panels, or moves them to another station', () => {
    const doc = withApi();
    const used = stationUsage(doc, 'main').length;
    expect(used).toBe(27);
    const dropped = prepare(removeStation(doc, 'main'));
    expect(dropped.stations.map((s) => s.id)).toEqual(['api']);
    expect(dropped.pages.flatMap((p) => p.panels)).toHaveLength(27);
    const moved = prepare(removeStation(doc, 'main', { rebind: 'api' }));
    expect(moved.pages.flatMap((p) => p.panels).filter((q) => q.station === 'api')).toHaveLength(54);
    expect(() => removeStation(dropped, 'api')).toThrow(/last station/);
    expect(() => removeStation(doc, 'main', { rebind: 'main' })).toThrow(/cannot rebind/);
  });

  it('sets the Prometheus URL', () => {
    expect(prepare(setPrometheusUrl(withApi(), ' http://prom:9090 ')).prometheus.url).toBe('http://prom:9090');
    expect(() => setPrometheusUrl(withApi(), '  ')).toThrow(/empty/);
  });
});

describe('cartridges', () => {
  it('export, reset, import round-trips to an identical document', () => {
    const store = createDocStore({ doc: withApi(), storage: memoryStorage(), delay: 0 });
    store.setDoc((d) => updateStation(d, 'api', { thresh: { warn: 30, crit: 45 }, stages: ['ingress', 'auth'] }));
    const before = store.getDoc();
    const file = cartridgeText(before);

    store.setDoc(defaultDoc()); // RESET
    expect(store.getDoc()).not.toEqual(before);

    const r = readCartridge(file); // IMPORT
    expect(r.errors).toBeUndefined();
    expect(r.summary).toEqual({ stations: ['INFERENCE-01', 'API-01'], pages: 10, version: 1 });
    store.setDoc(r.doc); // Replace
    expect(store.getDoc()).toEqual(before);
    expect(JSON.stringify(store.getDoc())).toBe(JSON.stringify(before));
  });

  it('refuses an invalid file with readable errors, and nothing changes', () => {
    const store = createDocStore({ doc: withApi(), storage: memoryStorage(), delay: 0 });
    const before = store.getDoc();
    expect(readCartridge('{"version": 1, "stations": [').errors[0]).toMatch(/^not a JSON file/);
    expect(readCartridge('{"version": 7}').errors).toEqual(['document version 7 is newer than this display (1)']);
    const bad = readCartridge(JSON.stringify({ version: 1, stations: [{ id: '*', name: '', source: { kind: 'sim' } }], pages: [] }));
    expect(bad.doc).toBeUndefined();
    expect(bad.errors).toEqual([
      'stations.0.id: letters, digits, _ . - (max 32), not starting with a symbol',
      expect.stringMatching(/^stations\.0\.name: /),
      expect.stringMatching(/^pages: /),
    ]);
    // the plate only calls setDoc with a doc it got back, so the store is untouched
    expect(store.getDoc()).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it('migrates an old cartridge on import', () => {
    const r = readCartridge(JSON.stringify({ station: 'edge-eu-2', hosts: 48 }));
    expect(r.summary).toEqual({ stations: ['EDGE-EU-2'], pages: 5, version: 0 });
    expect(r.doc.version).toBe(1);
  });

  it('merges: same station kept, a clashing id renamed with its panels, pages appended', () => {
    const current = withApi();
    const incoming = prepare({
      version: 1,
      stations: [
        { id: 'api', name: 'OTHER', source: { kind: 'prometheus', station: 'api' } }, // same station
        { id: 'main', name: 'EDGE', source: { kind: 'sim', hosts: 8, seed: 4 } }, // same id, another source
      ],
      pages: [
        { id: 'tape', name: 'Edge', panels: [{ id: 'm', type: 'meter', station: 'main', x: 0, y: 0, w: 4, h: 3, options: {} }] },
        { id: 'x', name: 'Api', panels: [{ id: 'm', type: 'meter', station: 'api', x: 0, y: 0, w: 4, h: 3, options: {} }] },
      ],
    });
    const merged = prepare(mergeDocs(current, incoming));
    expect(merged.stations.map((s) => [s.id, s.name])).toEqual([
      ['main', 'INFERENCE-01'],
      ['api', 'API-01'],
      ['main-2', 'EDGE'],
    ]);
    expect(merged.pages).toHaveLength(12);
    expect(merged.pages.slice(-2).map((p) => [p.id, p.panels[0].station])).toEqual([
      ['tape-2', 'main-2'],
      ['x', 'api'],
    ]);
    expect(merged.device).toEqual(current.device);
  });

  it('names the file by the date', () => {
    expect(cartridgeName(new Date(2026, 10, 7, 23, 59))).toBe('mars-2026-11-07.mars.json');
  });
});

describe('discovery for the plate', () => {
  const fake = (routes) =>
    createPromClient({
      fetch: async (url) => {
        const path = new URL(url, 'http://x').pathname.replace(/^.*\/api\/v1\//, '');
        return { status: 200, json: async () => fx(routes[path]) };
      },
    });

  it('lists the stations Prometheus knows and reads their P50 and RPS in one query', async () => {
    const client = fake({ 'label/station/values': 'labels-station.json', query: 'readouts.json', 'status/buildinfo': 'buildinfo.json' });
    expect(await stationValues(client, 1794036853)).toEqual(['api', 'search']);
    const live = await readouts(client);
    expect([...live.keys()].sort()).toEqual(['api', 'search']);
    expect(live.get('api').rps).toBe(44);
    expect(live.get('api').p50).toBeGreaterThan(5);
    expect((await client.buildinfo()).version).toBe('3.16.0');
  });
});
