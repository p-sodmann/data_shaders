import { describe, expect, it } from 'vitest';
import { createAlmanac } from '../src/data/almanac.js';
import { createProfile } from '../src/station/profile.js';
import { stationHistoryKey } from '../src/station/station.js';

const record = (mi, errorRate = 0) => ({ mi, latency: 10, throughput: 100, errorRate, saturation: 0 });

it.each([1, 7])('calculates budgets and coverage over the configured %i days', (days) => {
  const almanac = createAlmanac({ profile: createProfile({ slo: { days, target: 0.99 } }), key: 'test' });
  try {
    const end = 100_000, count = days * 1440;
    almanac.fill([record(end - count, 1), ...Array.from({ length: count }, (_, i) => record(end - count + i + 1))]);
    expect(almanac.analyse().consumed).toBe(0);
    expect(almanac.analyse().coverage).toBe(1);
  } finally {
    almanac.dispose();
  }
});

it('includes errors on the first minute inside the SLO window', () => {
  const almanac = createAlmanac({ profile: createProfile({ slo: { days: 1, target: 0.99 } }), key: 'test' });
  try {
    almanac.fill([record(10000 - 1440 + 1, 0.02), record(10000)]);
    expect(almanac.analyse().consumed).toBeCloseTo(1);
    expect(almanac.analyse().coverage).toBeCloseTo(2 / 1440);
  } finally {
    almanac.dispose();
  }
});

describe('station history identity', () => {
  const def = { id: 'api', source: { kind: 'prometheus', station: 'api' } };
  it('isolates backend URLs and Prometheus station labels', () => {
    const key = stationHistoryKey(def, '/prom');
    expect(stationHistoryKey(def, '/other')).not.toBe(key);
    expect(stationHistoryKey({ ...def, source: { ...def.source, station: 'search' } }, '/prom')).not.toBe(key);
    expect(stationHistoryKey(def, '/prom/')).toBe(key);
    expect(stationHistoryKey({ ...def, thresh: { warn: 50 } }, '/prom')).toBe(key);
  });
  it('isolates polling feeds from each other and from Prometheus', () => {
    const poll = { id: def.id, source: { kind: 'poll', url: '/feed' } };
    expect(stationHistoryKey(poll)).not.toBe(stationHistoryKey(def));
    expect(stationHistoryKey(poll)).not.toBe(stationHistoryKey({ ...poll, source: { ...poll.source, url: '/other' } }));
  });
});

it('replaces a partially observed minute with recovered history and does not recommit its old accumulator', () => {
  const almanac = createAlmanac({ profile: createProfile(), key: 'test' });
  try {
    almanac.add({ t: 600, latency: 99, throughput: 100, errorRate: 0.5, saturation: 1 }, 'INCIDENT');
    almanac.fill([record(10, 0.01)], { overwrite: true });
    almanac.add({ t: 720, latency: 12, throughput: 100, errorRate: 0, saturation: 0 }, 'NOMINAL');
    expect(almanac.at(10).lat).toBe(10);
    expect(almanac.at(10).err).toBeCloseTo(0.01);
  } finally {
    almanac.dispose();
  }
});
