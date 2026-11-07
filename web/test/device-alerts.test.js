import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeviceAlerts } from '../src/data/prometheus/device-alerts.js';
import { createStationManager } from '../src/station/manager.js';

const alert = (alertname, labels = {}, state = 'firing') => ({ state, labels: { alertname, ...labels } });

describe('device alerts', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps alerts without a station label, and logs firing and resolved', async () => {
    vi.useFakeTimers();
    let list = [alert('DiskFull'), alert('HighLatency', { station: 'api' }), alert('Pending', {}, 'pending')];
    const watch = createDeviceAlerts({ client: { alerts: async () => list }, every: 1000 });
    const seen = vi.fn();
    watch.subscribe(seen);
    await watch.start();
    expect(watch.external).toEqual([{ name: 'DiskFull', severity: '' }]);
    expect(watch.events.map((e) => e.text)).toEqual(['EXT ALERT DISKFULL FIRING']);
    expect(seen).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // no change, no notification
    expect(seen).toHaveBeenCalledTimes(1);

    list = [alert('CertExpiry', { severity: 'warning' })];
    await vi.advanceTimersByTimeAsync(1000);
    expect(watch.external).toEqual([{ name: 'CertExpiry', severity: 'warning' }]);
    expect(watch.events.map((e) => e.text).slice(1)).toEqual(['EXT ALERT CERTEXPIRY FIRING', 'EXT ALERT DISKFULL RESOLVED']);
    expect(watch.events.at(-1).level).toBe(0);
    watch.stop();
  });

  it('keeps what was firing when Prometheus is unreachable', async () => {
    let down = false;
    const watch = createDeviceAlerts({
      client: { alerts: async () => (down ? Promise.reject(new TypeError('fetch failed')) : [alert('DiskFull')]) },
    });
    await watch.start();
    down = true;
    await watch.start(); // already running: no second timer
    watch.stop();
    await watch.start();
    expect(watch.external).toHaveLength(1);
    watch.stop();
  });

  it('the manager watches only while a Prometheus station exists', () => {
    const made = [];
    const watchAlerts = (opts) => {
      const w = { opts, external: [], events: [], start: vi.fn(), stop: vi.fn(), subscribe: () => () => {} };
      made.push(w);
      return w;
    };
    const stub = (def) => ({ id: def.id, name: def.name, store: { events: [] }, start() {}, stop() {} });
    const m = createStationManager({ create: stub, watchAlerts });
    const sim = { id: 's', name: 'S', source: { kind: 'sim' } };
    const prom = { id: 'p', name: 'P', source: { kind: 'prometheus', station: 'api' } };
    m.sync([sim]);
    expect(m.device.alerts).toBe(null);
    m.sync([sim, prom], { prometheus: '/prom' });
    expect(made).toHaveLength(1);
    expect(made[0].opts.url).toBe('/prom');
    m.sync([sim, prom], { prometheus: '/prom' }); // same URL: same watch
    expect(made).toHaveLength(1);
    m.sync([sim, prom], { prometheus: 'http://other:9090' });
    expect(made).toHaveLength(2);
    expect(made[0].stop).toHaveBeenCalled();
    m.sync([sim]);
    expect(made[1].stop).toHaveBeenCalled();
    expect(m.device.alerts).toBe(null);
    m.dispose();
  });
});
