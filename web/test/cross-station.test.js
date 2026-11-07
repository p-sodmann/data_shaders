import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStationManager } from '../src/station/manager.js';
import { REGISTRY } from '../src/instruments/registry.js';
import { placeFor } from '../src/config/edit.js';
import { CODE, stationCode, pressureOf, numerals } from '../src/instruments/stations.js';
import { boardLayout, createStationBoard } from '../src/instruments/board.js';
import { createStationRadar } from '../src/instruments/stationradar.js';
import { createStationStrands } from '../src/instruments/strands.js';

const sim = (id, extra = {}) => ({ id, name: `${id.toUpperCase()}-01`, source: { kind: 'sim', hosts: 4, seed: 1 }, ...extra });

// a vector painter that remembers the text it was asked to draw
function painter(w = 800, h = 500) {
  const texts = [];
  let lines = 0;
  return {
    w, h, texts,
    get lines() {
      return lines;
    },
    dot() {},
    line() {
      lines++;
    },
    text: (x, y, s) => texts.push(s),
    textWidth: (s, size = 1) => s.length * 6 * size,
  };
}
const frame = (now = 1000) => ({ now, dt: 1 / 60, time: now / 1000, w: 800, h: 400, dpr: 1, cssW: 800, cssH: 400 });

// fake GL for the board's data textures: each upload is recorded
function fakeEngine() {
  const uploads = [];
  const gl = { RGBA8: 'rgba8', RGBA: 'rgba', R8: 'r8', RED: 'red', UNSIGNED_BYTE: 'u8' };
  const engine = {
    dataTexture: ({ internal }) => ({ tex: internal, upload: (w, h, data) => uploads.push({ internal, w, h, data: data.slice() }), dispose() {} }),
  };
  return { gl, engine, uploads };
}

describe('station readings', () => {
  const station = (status, { phase = 'live', disp = { lat: 10, tp: 100, err: 0 }, sat = 0.2 } = {}) => ({
    getStatus: () => ({ phase }),
    store: { status, disp, latest: { saturation: sat }, profile: { thresh: { crit: 40, errCrit: 0.02, satCrit: 0.9 } } },
  });

  it('maps the station status to a lamp code; loading reads as stale', () => {
    expect(stationCode(station('NOMINAL'))).toBe(CODE.NOMINAL);
    expect(stationCode(station('DEGRADED'))).toBe(CODE.DEGRADED);
    expect(stationCode(station('INCIDENT'))).toBe(CODE.INCIDENT);
    expect(stationCode(station('STALE'))).toBe(CODE.STALE);
    expect(stationCode(station('NOMINAL', { phase: 'load' }))).toBe(CODE.STALE);
  });

  it('takes the worst of latency, errors and saturation against their crit limits', () => {
    expect(pressureOf(station('NOMINAL').store)).toBeCloseTo(0.25); // 10 / 40
    expect(pressureOf(station('NOMINAL', { disp: { lat: 10, tp: 1, err: 0.03 } }).store)).toBeCloseTo(1.5);
    expect(pressureOf(station('NOMINAL', { sat: 0.81 }).store)).toBeCloseTo(0.9);
    expect(pressureOf(station('NOMINAL', { disp: null }).store)).toBeNull();
  });

  it('reads the thresholds through the store, so a retune shows at once', () => {
    const s = station('NOMINAL');
    s.store.profile = { thresh: { crit: 20, errCrit: 0.02, satCrit: 0.9 } };
    expect(pressureOf(s.store)).toBeCloseTo(0.5);
  });

  it('offers shorter numerals for narrow lamps', () => {
    expect(numerals(station('NOMINAL'), CODE.NOMINAL)).toEqual(['10.0 MS  100 RPS', '10.0MS 100RPS', '10.0 MS']);
    expect(numerals(station('STALE'), CODE.STALE)).toEqual(['STALE']);
    expect(numerals(station('NOMINAL', { phase: 'load' }), CODE.STALE)[0]).toBe('TAPE LOAD');
  });
});

describe('board layout', () => {
  it('keeps every lamp on the face and one pitch for all names', () => {
    const names = ['A-01', 'INFERENCE-01', 'B'];
    const { pitch, lamps } = boardLayout(names, 2, 2, 600, 300);
    expect(lamps).toHaveLength(3);
    for (const l of lamps) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.x + l.w).toBeLessThanOrEqual(600);
      expect(l.y + l.h).toBeLessThanOrEqual(300);
    }
    // the longest name fits its lamp at that pitch
    expect(12 * 6 * pitch).toBeLessThanOrEqual(lamps[1].w);
    const long = boardLayout(['A-VERY-LONG-STATION-NAME'], 2, 2, 600, 300).pitch;
    expect(long).toBeLessThan(boardLayout(['A'], 2, 2, 600, 300).pitch);
  });
});

describe('cross-station registry entries', () => {
  it('are device-scoped, described for the bay, and fit an empty page', () => {
    for (const type of ['stationBoard', 'stationRadar', 'stationStrands', 'stationLog']) {
      const def = REGISTRY[type];
      expect(def.scope).toBe('device');
      expect(def.reads).not.toBe('');
      expect(def.defaultSize[0]).toBeGreaterThanOrEqual(def.minW);
      expect(def.defaultSize[1]).toBeGreaterThanOrEqual(def.minH);
      expect(placeFor([], def)).toBeTruthy();
    }
  });
});

describe('instruments on the device', () => {
  let manager;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    manager = createStationManager({ watchAlerts: () => ({ subscribe: () => () => {}, start() {}, stop() {}, events: [] }) });
  });
  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('device.subscribe follows stations that come and go', () => {
    const fn = vi.fn();
    const off = manager.device.subscribe(fn);
    manager.sync([sim('a')]);
    const first = manager.device.getSnapshot();
    manager.sync([sim('a'), sim('b')]);
    expect(fn).toHaveBeenCalled();
    expect(manager.device.getSnapshot()).not.toBe(first);
    expect(manager.device.stations.map((s) => s.id)).toEqual(['a', 'b']);
    off();
  });

  it('radar and strands built once show stations added and removed later', async () => {
    manager.sync([sim('a')]);
    await vi.advanceTimersByTimeAsync(2000);
    const radar = createStationRadar(manager.device);
    const strands = createStationStrands(manager.device);
    let v = painter();
    radar.render(null, null, frame(), v);
    strands.render(null, null, frame(), v);
    expect(v.texts).toContain('A-01');
    expect(v.texts).not.toContain('B-01');

    manager.sync([sim('a'), sim('b', { source: { kind: 'sim', hosts: 4, seed: 2 } })]);
    await vi.advanceTimersByTimeAsync(2000);
    v = painter();
    radar.render(null, null, frame(8000), v);
    strands.render(null, null, frame(8000), v);
    expect(v.texts.filter((s) => s === 'B-01').length).toBeGreaterThanOrEqual(2);
    expect(v.texts).toContain('STATIONS 2');

    manager.sync([sim('b', { source: { kind: 'sim', hosts: 4, seed: 2 } })]);
    v = painter();
    strands.render(null, null, frame(9000), v);
    expect(v.texts).not.toContain('A-01');
  });

  it('strands draw a bounded number of segments however many stations there are', async () => {
    const count = async (n) => {
      manager.sync(Array.from({ length: n }, (_, i) => sim(`s${i}`, { source: { kind: 'sim', hosts: 4, seed: i + 1 } })));
      await vi.advanceTimersByTimeAsync(1000);
      const v = painter();
      createStationStrands(manager.device).render(null, null, frame(), v);
      return v.lines;
    };
    const eight = await count(8);
    const sixteen = await count(16);
    expect(sixteen).toBeLessThan(eight * 1.25);
  });

  it('the board uploads one lamp per station and redraws labels only when they change', async () => {
    manager.sync([sim('a'), sim('b', { source: { kind: 'sim', hosts: 4, seed: 2 } })]);
    await vi.advanceTimersByTimeAsync(2000);
    const { gl, engine, uploads } = fakeEngine();
    const board = createStationBoard(manager.device);
    board.init(gl, engine);
    const u = board.update(gl, null, frame());
    const lamps = uploads.filter((x) => x.internal === 'rgba8').at(-1);
    expect(lamps.w * lamps.h).toBeGreaterThanOrEqual(2);
    expect([lamps.data[3], lamps.data[7]]).toEqual([255, 255]);
    expect(u.uLabelGrid[0]).toBeGreaterThan(1);
    const labels = uploads.filter((x) => x.internal === 'r8').length;
    board.update(gl, null, frame(1016)); // same second, same numerals
    expect(uploads.filter((x) => x.internal === 'r8').length).toBe(labels);

    // a stale station goes dark (code 3, no fill)
    manager.device.stations[1].store.setStale(true);
    board.update(gl, null, frame(1032));
    const after = uploads.filter((x) => x.internal === 'rgba8').at(-1).data;
    expect(after[4 + 1]).toBe(CODE.STALE * 60);
    expect(after[4]).toBe(0);
  });
});
