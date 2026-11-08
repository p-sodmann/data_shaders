import { describe, expect, it } from 'vitest';
import { createSignal, rhythmSignals } from '../src/data/signal.js';

// A store with one hour of 1 s samples made by `gen(signal, t)`: enough for
// the rhythm search (it needs 20 min), not for the 4 h reference.
const NOW = 1_800_000_000;
function fakeStore(gen, SPAN = 3600) {
  return {
    signals: ['LAT', 'ERR', 'TPUT', 'SAT'],
    latest: { t: NOW },
    now: () => NOW,
    window(k, t0, n, step = 1) {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = t0 + i * step;
        out[i] = t > NOW || t <= NOW - SPAN ? NaN : gen(k, t);
      }
      return out;
    },
  };
}

// deterministic noise in -1..1
const noise = (t, k) => {
  const x = Math.sin(t * 12.9898 + k * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

const profile = { thresh: { warn: 25, crit: 35 } };
const batch = (t) => t % 300 < 20; // a 20 s job every 5 minutes

function rhythms(gen, span) {
  const signal = createSignal(fakeStore(gen, span), profile);
  signal.update(0);
  return signal.spec.peaks;
}

describe('rhythm search', () => {
  it('finds a batch job that shows only in throughput', () => {
    const peaks = rhythms((k, t) => {
      if (k === 0) return 12 + noise(t, 0) * 0.4; // latency: flat
      if (k === 2) return 30 * (batch(t) ? 1.4 : 1) + noise(t, 2) * 1.5;
      return k === 3 ? 0.3 : 0.001;
    });
    const r = peaks.find((p) => Math.abs(p.period - 300) <= 5);
    expect(r).toBeTruthy();
    expect(r.signal).toBe('thru');
    expect(r.signals).toEqual(['thru']);
    expect(r.amp).toBeGreaterThan(12); // % of the median throughput
    expect(rhythmSignals(r)).toBe('THRU');
  });

  it('reports a rhythm in both signals once', () => {
    const peaks = rhythms((k, t) => {
      if (k === 0) return 12 + (batch(t) ? 4 : 0) + noise(t, 0) * 0.4;
      if (k === 2) return 30 * (batch(t) ? 1.4 : 1) + noise(t, 2) * 1.5;
      return k === 3 ? 0.3 : 0.001;
    });
    const near = peaks.filter((p) => Math.abs(p.period - 300) <= 6);
    expect(near).toHaveLength(1);
    expect([...near[0].signals].sort()).toEqual(['lat', 'thru']);
  });

  it('still finds latency-only rhythms', () => {
    const peaks = rhythms((k, t) => {
      if (k === 0) return 12 + (batch(t) ? 4 : 0) + noise(t, 0) * 0.4;
      if (k === 2) return 30 + noise(t, 2) * 1.5;
      return k === 3 ? 0.3 : 0.001;
    });
    const r = peaks.find((p) => Math.abs(p.period - 300) <= 5);
    expect(r?.signal).toBe('lat');
    expect(r.signals).toEqual(['lat']);
  });

  it('finds a batch job under a stronger traffic swing, in 50 minutes', () => {
    // the demo stack: a compressed 10-minute "day" (±50 %) and the 5-minute batch job.
    // The swing is the traffic's shape, not a job: it is taken off, not reported.
    const peaks = rhythms((k, t) => {
      if (k === 0) return 12 + noise(t, 0) * 0.4;
      if (k === 2) return 30 * (1 + 0.5 * Math.sin((2 * Math.PI * t) / 600)) * (batch(t) ? 1.4 : 1) + noise(t, 2) * 1.5;
      return k === 3 ? 0.3 : 0.001;
    }, 3000);
    expect(peaks.map((p) => [Math.round(p.period / 5) * 5, p.signal])).toEqual([[300, 'thru']]);
  });

  it("doesn't try periods with fewer than four cycles of data", () => {
    // 25 min of a 10-minute swing: not confirmable yet, and nothing else reported instead
    const peaks = rhythms((k, t) => (k === 2 ? 30 * (1 + 0.5 * Math.sin((2 * Math.PI * t) / 600)) + noise(t, 2) : k === 0 ? 12 + noise(t, 0) * 0.4 : 0.3), 1500);
    expect(peaks.filter((p) => p.period > 1500 / 4)).toEqual([]);
  });

  it('finds nothing in noise', () => {
    const peaks = rhythms((k, t) => (k === 0 ? 12 + noise(t, 0) * 0.4 : k === 2 ? 30 + noise(t, 2) * 1.5 : 0.3));
    expect(peaks).toEqual([]);
  });
});

it('rebuilds cached historical analysis when missed samples are restored', () => {
  let missing = true;
  const store = fakeStore((k, t) => missing ? NaN : k === 0 ? 12 + 4 * Math.sin(t / 30) : k === 2 ? 100 : 0.2);
  const signal = createSignal(store, profile);
  signal.update(0);
  expect(signal.curve.cloud).toHaveLength(0);
  expect(signal.fall.rows.some((v) => v > 0)).toBe(false);
  missing = false;
  store.historyVersion = 1;
  // Same live timestamp: a normal streaming update would leave these caches alone.
  signal.update(1);
  expect(signal.curve.cloud.length).toBeGreaterThan(0);
  expect(signal.fall.rows.some((v) => v > 0)).toBe(true);
});
