import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelemetry } from '../src/data/telemetry.js';
import { createProfile } from '../src/station/profile.js';
import { recoveryFrame, revealed, RECOVERY_MS } from '../src/data/recovery.js';
import { onResume } from '../src/data/resume.js';
import { createSimulatedSource } from '../src/data/simulator.js';

const NOW = 1_800_000_700;
const sample = (t, latency = 12) => ({ t, latency, throughput: 30, errorRate: 0, saturation: 0.3, hostStates: Uint8Array.of(0), hostLoads: Float32Array.of(0.3), hostLatency: Float32Array.of(latency) });
const makeStore = () => createTelemetry({ profile: createProfile(), hostCount: 1, now: () => NOW, kind: 'LIVE', getSpeed: () => 1 });

describe('archive restoration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('fills missing tape, signal and node slots across rows without changing live state', () => {
    const store = makeStore(), live = sample(NOW);
    store.push(live);
    const ema = { ...store.ema }, disp = { ...store.disp }, state = store.state;
    const rowsVersion = store.rowsVersion;
    const samples = [sample(NOW - 700, 95), sample(NOW - 500, 80), sample(NOW - 2, 65)];
    expect(store.restore(samples)).toBe(3);
    expect(store.latencyAt(NOW - 700)).toBe(95);
    expect(store.latencyAt(NOW - 500)).toBe(80);
    expect(store.latencyAt(NOW - 499)).toBe(-1);
    expect(store.window(0, NOW - 2, 1)[0]).toBe(65);
    expect(store.hostLatAt(NOW - 500, 0)).toBe(80);
    expect(store.hostLatAt(NOW - 700, 0)).toBe(-1);
    expect(store.latest).toBe(live);
    expect(store.state).toBe(state);
    expect(store.ema).toEqual(ema);
    expect(store.disp).toEqual(disp);
    expect(store.hostLoads[0]).toBeCloseTo(0.3);
    expect(store.events.filter((e) => e.text.startsWith('SYSTEM'))).toEqual([]);
    expect(store.historyVersion).toBe(1);
    expect(store.rowsVersion).toBeGreaterThan(rowsVersion);
    expect(store.recovery).toMatchObject({ from: NOW - 700, to: NOW - 2, count: 3 });
  });

  it('is idempotent and preserves live samples and newer ring-buffer slots', () => {
    const store = makeStore();
    store.push(sample(NOW));
    const samples = [sample(NOW - 2), sample(NOW - 1), sample(NOW, 99), sample(NOW - 14400, 99), sample(NOW + 1, 99)];
    expect(store.restore(samples)).toBe(2);
    expect(store.restore(samples)).toBe(0);
    expect(store.latencyAt(NOW)).toBe(12);
    expect(store.hostLatAt(NOW, 0)).toBe(12);
    expect(store.window(0, NOW, 1)[0]).toBe(12);
    expect(store.historyVersion).toBe(1);
  });

  it('completes the animation and respects reduced motion', () => {
    const store = makeStore();
    store.push(sample(NOW));
    store.restore([sample(NOW - 3), sample(NOW - 2), sample(NOW - 1)]);
    const start = recoveryFrame(store.recovery, store.recovery.at);
    expect(revealed(NOW - 1, start)).toBe(false);
    expect(revealed(NOW, start)).toBe(true); // the live readout is always present
    expect(recoveryFrame(store.recovery, store.recovery.at + RECOVERY_MS)).toBeNull();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    store.markRecovery(NOW - 3, NOW - 1, 3);
    expect(recoveryFrame(store.recovery)).toBeNull();
    expect(store.latencyAt(NOW - 1)).toBe(12);
  });

  it('deduplicates visibility/focus cleanup and ignores hidden wakeups', () => {
    const target = new EventTarget(), doc = new EventTarget();
    doc.visibilityState = 'hidden';
    vi.stubGlobal('addEventListener', target.addEventListener.bind(target));
    vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target));
    vi.stubGlobal('document', doc);
    const wake = vi.fn(), off = onResume(wake);
    target.dispatchEvent(new Event('focus'));
    expect(wake).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(wake).toHaveBeenCalledTimes(1);
    off();
    target.dispatchEvent(new Event('focus'));
    target.dispatchEvent(new Event('pageshow'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(wake).toHaveBeenCalledTimes(1);
  });
});

describe('simulation recovery', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('does not treat normal high-speed playback as a sleeping tab', async () => {
    vi.useFakeTimers();
    const source = createSimulatedSource({ profile: createProfile(), speed: 60, hostCount: 1, seed: 1 });
    const store = { markRecovery: vi.fn() };
    await source.backfill(source.now() - 1);
    source.start(vi.fn(), store);
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(store.markRecovery).not.toHaveBeenCalled();
    } finally {
      source.stop();
    }
  });
  it('marks recovered samples after the simulation timer was suspended', async () => {
    vi.useFakeTimers();
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const source = createSimulatedSource({ profile: createProfile(), hostCount: 1, seed: 1 });
    const store = { markRecovery: vi.fn() }, push = vi.fn();
    await source.backfill(source.now() - 1);
    source.start(push, store);
    try {
      push.mockClear();
      wall = 120000;
      await vi.advanceTimersByTimeAsync(250);
      expect(push).toHaveBeenCalledTimes(120);
      expect(store.markRecovery).toHaveBeenCalledTimes(1);
    } finally {
      source.stop();
    }
  });
});
