import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStationManager, worstStation } from '../src/station/manager.js';
import { createStation } from '../src/station/station.js';

// Real sim stations on fake timers: each start() backfills 4 h and starts an interval.
const sim = (id, extra = {}) => ({ id, name: id.toUpperCase(), source: { kind: 'sim', hosts: 8, seed: 1 }, ...extra });

describe('station manager', () => {
  let manager, created;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    created = [];
    manager = createStationManager({
      create: (def) => {
        const s = createStation(def);
        vi.spyOn(s, 'stop');
        created.push(s);
        return s;
      },
    });
  });
  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates and starts a station per entry, in document order', () => {
    manager.sync([sim('a'), sim('b')]);
    expect(manager.list().map((s) => s.id)).toEqual(['a', 'b']);
    // started: the source is pushing samples
    const before = manager.get('a').store.latest.t;
    vi.advanceTimersByTime(3000);
    expect(manager.get('a').store.latest.t).toBeGreaterThan(before);
  });

  it('keeps unchanged stations and does not notify', () => {
    const fn = vi.fn();
    manager.sync([sim('a'), sim('b')]);
    const [a, b] = manager.list();
    manager.subscribe(fn);
    manager.sync([sim('a'), sim('b')]);
    expect(manager.list()).toEqual([a, b]);
    expect(created).toHaveLength(2);
    expect(fn).not.toHaveBeenCalled();
  });

  it('adds and removes stations', () => {
    manager.sync([sim('a'), sim('b')]);
    const [a, b] = manager.list();
    const fn = vi.fn();
    manager.subscribe(fn);
    manager.sync([sim('a'), sim('c')]);
    expect(manager.list().map((s) => s.id)).toEqual(['a', 'c']);
    expect(manager.get('a')).toBe(a);
    expect(b.stop).toHaveBeenCalledTimes(1);
    expect(a.stop).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('recreates a station whose source changed', () => {
    manager.sync([sim('a')]);
    const old = manager.get('a');
    manager.sync([sim('a', { source: { kind: 'sim', hosts: 16, seed: 1 } })]);
    expect(manager.get('a')).not.toBe(old);
    expect(manager.get('a').source.hostCount).toBe(16);
    expect(old.stop).toHaveBeenCalled();
  });

  it('recreates a station whose profile changed (profiles are frozen)', () => {
    manager.sync([sim('a')]);
    const old = manager.get('a');
    manager.sync([sim('a', { thresh: { warn: 10 } })]);
    expect(manager.get('a')).not.toBe(old);
    expect(manager.get('a').profile.thresh.warn).toBe(10);
    expect(manager.get('a').profile.thresh.crit).toBe(35);
    expect(old.stop).toHaveBeenCalled();
  });

  it('notifies on a reorder without recreating', () => {
    manager.sync([sim('a'), sim('b')]);
    const fn = vi.fn();
    manager.subscribe(fn);
    manager.sync([sim('b'), sim('a')]);
    expect(manager.list().map((s) => s.id)).toEqual(['b', 'a']);
    expect(created).toHaveLength(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('skips sources it cannot run yet', () => {
    manager.sync([sim('a'), { id: 'p', name: 'P', source: { kind: 'prometheus', station: 'p' } }]);
    expect(manager.list().map((s) => s.id)).toEqual(['a']);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('gives cross-station instruments one live view', () => {
    const { device } = manager;
    manager.sync([sim('a')]);
    expect(device.stations.map((s) => s.id)).toEqual(['a']);
    manager.sync([sim('a'), sim('b')]);
    expect(device.stations.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('stops stopped stations for good', () => {
    manager.sync([sim('a')]);
    const a = manager.get('a');
    manager.sync([sim('b')]);
    const t = a.store.latest.t;
    vi.advanceTimersByTime(3000);
    expect(a.store.latest.t).toBe(t);
  });
});

describe('worstStation', () => {
  const st = (id, state) => ({ id, store: { state } });
  it('picks the worst state, first in order on a tie', () => {
    expect(worstStation([st('a', 'NOMINAL'), st('b', 'DEGRADED'), st('c', 'DEGRADED')]).id).toBe('b');
    expect(worstStation([st('a', 'DEGRADED'), st('b', 'INCIDENT')]).id).toBe('b');
    expect(worstStation([st('a', 'NOMINAL'), st('b', 'NOMINAL')]).id).toBe('a');
    expect(worstStation([])).toBeNull();
  });
});

describe('station signal reference count', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops the analyser only after the last holder lets go', () => {
    const s = createStation(sim('a'));
    const sig = s.signal;
    const release1 = s.retainSignal();
    const release2 = s.retainSignal();
    release1();
    release1(); // twice is harmless
    vi.advanceTimersByTime(10);
    expect(s.signal).toBe(sig);
    release2();
    vi.advanceTimersByTime(10);
    expect(s.signalRefs).toBe(0);
    expect(s.signal).not.toBe(sig);
  });

  it('keeps the analyser across a page switch (release, then retain in the same tick)', () => {
    const s = createStation(sim('a'));
    const sig = s.signal;
    const release = s.retainSignal();
    release();
    const again = s.retainSignal();
    vi.advanceTimersByTime(10);
    expect(s.signal).toBe(sig);
    again();
  });
});
