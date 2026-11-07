import { createPromClient } from './client.js';

// Firing Prometheus alerts that name no station: they belong to the device as
// a whole (a disk, a certificate, the scrape itself). They light the header's
// EXT lamp and are logged without a station name, but don't change any
// station's state. Alerts with a `station` label are each station's own
// (source.js). One watch per device, polled every 10 s while it runs.

export const ALERT_EVERY = 10_000;

export function createDeviceAlerts({ url = '/prom', fetch, client = createPromClient({ url, fetch }), every = ALERT_EVERY } = {}) {
  let external = Object.freeze([]);
  const events = [];
  const listeners = new Set();
  let timer = null;

  const log = (level, text) => {
    events.push({ t: Date.now() / 1000, wall: performance.now(), level, text });
    if (events.length > 120) events.splice(0, events.length - 120);
  };

  async function check() {
    let alerts;
    try {
      alerts = await client.alerts();
    } catch {
      return; // the stations show NO CONTACT; keep what was firing
    }
    const firing = new Map();
    for (const a of alerts) {
      if (a.state !== 'firing' || a.labels?.station) continue;
      const name = a.labels?.alertname ?? 'ALERT';
      firing.set(name, { name, severity: a.labels?.severity ?? '' });
    }
    const had = new Set(external.map((a) => a.name));
    const fired = [...firing.keys()].filter((name) => !had.has(name));
    const resolved = [...had].filter((name) => !firing.has(name));
    for (const name of fired) log(1, `EXT ALERT ${name.toUpperCase()} FIRING`);
    for (const name of resolved) log(0, `EXT ALERT ${name.toUpperCase()} RESOLVED`);
    if (!fired.length && !resolved.length) return;
    external = Object.freeze([...firing.values()]);
    listeners.forEach((fn) => fn());
  }

  return {
    get external() {
      return external;
    },
    events,
    // resolves after the first check, so tests and callers can await it
    start() {
      if (timer) return Promise.resolve();
      timer = setInterval(check, every);
      return check();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
