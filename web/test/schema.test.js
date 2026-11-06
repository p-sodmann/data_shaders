import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDoc } from '../src/config/schema.js';
import { defaultDoc } from '../src/config/load.js';
import { standardPages } from '../src/config/presets.js';

const station = (id, extra = {}) => ({ id, name: id.toUpperCase(), source: { kind: 'sim' }, ...extra });
const doc = (over = {}) => ({ version: 1, stations: [station('main')], pages: [{ id: 'p', name: 'P', panels: [] }], ...over });
const panel = (id, x, y, w, h, extra = {}) => ({ id, type: 'tape', station: 'main', x, y, w, h, ...extra });
const errorOf = (raw) => {
  const r = parseDoc(raw);
  expect(r.ok).toBe(false);
  return r.error;
};

describe('config schema v1', () => {
  it('accepts the built-in default and fills in defaults', () => {
    const r = parseDoc(defaultDoc());
    expect(r.ok).toBe(true);
    expect(r.doc.device).toEqual({ finish: 'graphite', fps: 60, dpr: 2, cycle: 0, locked: false });
    expect(r.doc.stations[0].source).toEqual({ kind: 'sim', hosts: 32 });
    expect(r.doc.pages).toHaveLength(5);
  });

  it('accepts the shipped two-station example', () => {
    const raw = JSON.parse(readFileSync(new URL('../public/examples/two-stations.json', import.meta.url), 'utf8'));
    const r = parseDoc(raw);
    expect(r.error).toBeUndefined();
    expect(r.doc.stations.map((s) => s.id)).toEqual(['main', 'search']);
  });

  it('accepts the ADR-0005 example (prometheus source and all)', () => {
    const r = parseDoc({
      version: 1,
      device: { finish: 'graphite', fps: 60, dpr: 2, cycle: 0, locked: false },
      prometheus: { url: '/prom' },
      stations: [
        { id: 'api', name: 'API-01', source: { kind: 'prometheus', station: 'api' }, thresh: { warn: 25, crit: 35 }, slo: { target: 0.995, days: 30 }, home: { lat: 50.1, lon: 8.7 } },
        { id: 'sim', name: 'INFERENCE-01', source: { kind: 'sim', hosts: 32, seed: 1 } },
      ],
      pages: [{ id: 'tape', name: 'Tape', panels: [panel('p1', 0, 0, 8, 5, { station: 'api', options: {} })] }],
    });
    expect(r.error).toBeUndefined();
  });

  it('accepts poll sources', () => {
    expect(parseDoc(doc({ stations: [station('a', { source: { kind: 'poll', url: '/t.json' } })] })).ok).toBe(true);
    expect(errorOf(doc({ stations: [station('a', { source: { kind: 'poll' } })] }))).toMatch(/url/);
  });

  it('rejects unknown source kinds and versions', () => {
    errorOf(doc({ stations: [station('a', { source: { kind: 'carrier-pigeon' } })] }));
    errorOf(doc({ version: 2 }));
  });

  it('keeps unknown keys in panel options only', () => {
    const r = parseDoc(
      doc({
        extra: 1,
        stations: [station('main', { colour: 'red' })],
        pages: [{ id: 'p', name: 'P', panels: [panel('a', 0, 0, 6, 4, { options: { signal: 'x', future: { deep: true } }, junk: 1 })] }],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.doc.extra).toBeUndefined();
    expect(r.doc.stations[0].colour).toBeUndefined();
    expect(r.doc.pages[0].panels[0].junk).toBeUndefined();
    expect(r.doc.pages[0].panels[0].options).toEqual({ signal: 'x', future: { deep: true } });
  });

  it('requires unique ids', () => {
    expect(errorOf(doc({ stations: [station('a'), station('a')] }))).toMatch(/duplicate station id "a"/);
    const page = { id: 'p', name: 'P', panels: [] };
    expect(errorOf(doc({ pages: [page, page] }))).toMatch(/duplicate page id "p"/);
    expect(errorOf(doc({ pages: [{ id: 'p', name: 'P', panels: [panel('a', 0, 0, 2, 2), panel('a', 4, 0, 2, 2)] }] }))).toMatch(/duplicate panel id "a"/);
  });

  it('reserves * as a station binding, not an id', () => {
    errorOf(doc({ stations: [station('*')] }));
    expect(parseDoc(doc({ pages: [{ id: 'p', name: 'P', panels: [panel('log', 0, 0, 6, 2, { type: 'log', station: '*' })] }] })).ok).toBe(true);
  });

  it('keeps panels on the 12 × 8 grid', () => {
    expect(errorOf(doc({ pages: [{ id: 'p', name: 'P', panels: [panel('a', 8, 0, 5, 2)] }] }))).toMatch(/past column 12/);
    expect(errorOf(doc({ pages: [{ id: 'p', name: 'P', panels: [panel('a', 0, 7, 2, 2)] }] }))).toMatch(/past row 8/);
    errorOf(doc({ pages: [{ id: 'p', name: 'P', panels: [panel('a', -1, 0, 2, 2)] }] }));
    errorOf(doc({ pages: [{ id: 'p', name: 'P', panels: [panel('a', 0.5, 0, 2, 2)] }] }));
  });

  it('rejects overlapping panels but allows touching ones', () => {
    expect(errorOf(doc({ pages: [{ id: 'p', name: 'P', panels: [panel('a', 0, 0, 6, 4), panel('b', 5, 3, 4, 2)] }] }))).toMatch(/"b" overlaps "a"/);
    expect(parseDoc(doc({ pages: [{ id: 'p', name: 'P', panels: [panel('a', 0, 0, 6, 4), panel('b', 6, 0, 6, 4), panel('c', 0, 4, 12, 4)] }] })).ok).toBe(true);
  });

  it('needs at least one station and one page', () => {
    errorOf(doc({ stations: [] }));
    errorOf(doc({ pages: [] }));
  });

  it('standardPages fit the grid for any station', () => {
    const r = parseDoc(doc({ stations: [station('x')], pages: standardPages('x', 'x-') }));
    expect(r.error).toBeUndefined();
    expect(r.doc.pages.map((p) => p.id)).toEqual(['x-tape', 'x-orbit', 'x-sweep', 'x-signal', 'x-almanac']);
    expect(r.doc.pages.every((p) => p.panels.every((q) => q.station === 'x'))).toBe(true);
  });
});
