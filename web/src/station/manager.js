import { createStation } from './station.js';
import { createDeviceAlerts } from '../data/prometheus/device-alerts.js';

// Keeps one running station per entry of the document's `stations`.
//
// sync(defs, ctx) diffs by id: new ids are created and started, missing ids are
// stopped (which saves and closes their almanac), and an entry that changed in
// any way is replaced by a new station. A profile is frozen and instruments copy
// what they need when they are built, so there is nothing to patch in place;
// panels bound to a replaced station rebuild because the station object changed.
// ctx is { prometheus: base URL } from the document; a Prometheus station is
// also replaced when it changes.
//
// Stations start asynchronously and each on its own (station.js). When one
// changes phase or is rebuilt, the snapshot is renewed, so React re-reads
// stores that may have been swapped.
//
// Source kinds this build can't run get no station, so their panels show NO SIGNAL.
//
// While the document has a Prometheus station, the manager also watches the
// alerts that name no station (device.alerts: the header's EXT lamp, and the
// event logs bound to '*').

const RUNNABLE = new Set(['sim', 'poll', 'prometheus']);
// STALE sits between nominal and degraded: worth a look, not an alarm
const SEV = { NOMINAL: 0, STALE: 0.5, DEGRADED: 1, INCIDENT: 2 };

export function createStationManager({ create = createStation, watchAlerts = createDeviceAlerts } = {}) {
  let entries = new Map(); // id → { key, station, off }
  let snapshot = { list: Object.freeze([]), byId: Object.freeze({}) };
  const listeners = new Set();
  const skipped = new Set();
  let alerts = null, alertsUrl = null, alertsOff = null;

  // The device as cross-station instruments see it: always the current list.
  // One object for the whole session, so instruments built on it never need
  // rebuilding when stations come and go.
  const device = Object.freeze({
    get stations() {
      return snapshot.list;
    },
    get alerts() {
      return alerts;
    },
  });

  // one watch per Prometheus URL, only while some station reads from it
  function syncAlerts(defs, ctx) {
    const url = defs.some((d) => d.source.kind === 'prometheus') ? (ctx.prometheus ?? '/prom') : null;
    if (url === alertsUrl) return;
    stopAlerts();
    alertsUrl = url;
    if (!url) return;
    alerts = watchAlerts({ url, fetch: ctx.fetch });
    alertsOff = alerts.subscribe(() => listeners.forEach((fn) => fn()));
    Promise.resolve(alerts.start()).catch((e) => console.error('[MARS] alert watch failed', e));
  }
  function stopAlerts() {
    alertsOff?.();
    alerts?.stop();
    alerts = alertsOff = alertsUrl = null;
  }

  function publish() {
    const list = [...entries.values()].map((e) => e.station);
    snapshot = { list: Object.freeze(list), byId: Object.freeze(Object.fromEntries(list.map((s) => [s.id, s]))) };
    listeners.forEach((fn) => fn());
  }

  function sync(defs, ctx = {}) {
    syncAlerts(defs, ctx);
    const next = new Map();
    let changed = false;
    for (const def of defs) {
      if (!RUNNABLE.has(def.source.kind)) {
        if (!skipped.has(def.id)) console.warn(`[MARS] station "${def.id}": source kind "${def.source.kind}" is not supported yet`);
        skipped.add(def.id);
        continue;
      }
      skipped.delete(def.id);
      const key = JSON.stringify(def.source.kind === 'prometheus' ? [def, ctx.prometheus] : def);
      const old = entries.get(def.id);
      if (old && old.key === key) {
        next.set(def.id, old);
        continue;
      }
      const station = create(def, ctx);
      // a station whose phase or tables change may have a new store
      let last = station.getStatus?.();
      const off = station.subscribe?.(() => {
        const st = station.getStatus();
        if (st.phase !== last?.phase || st.generation !== last?.generation) publish();
        last = st;
      });
      Promise.resolve(station.start()).catch((e) => console.error(`[MARS] station "${def.id}" failed to start`, e));
      next.set(def.id, { key, station, off });
      changed = true;
    }
    for (const [id, { station, off }] of entries) {
      if (next.get(id)?.station !== station) {
        off?.();
        station.stop();
        changed = true;
      }
    }
    // doc order matters (first station drives the clock), so compare it too
    const order = (m) => [...m.keys()].join('\0');
    if (order(next) !== order(entries)) changed = true;
    entries = next;
    if (changed) publish();
  }

  return {
    sync,
    device,
    getSnapshot: () => snapshot,
    get: (id) => snapshot.byId[id],
    list: () => snapshot.list,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      stopAlerts();
      for (const { station, off } of entries.values()) {
        off?.();
        station.stop();
      }
      entries = new Map();
      snapshot = { list: Object.freeze([]), byId: Object.freeze({}) };
      listeners.forEach((fn) => fn());
    },
  };
}

// The station in the worst state (store.status, so STALE and external alerts
// count); the first one in document order on a tie,
// so the readout doesn't flicker between equals. null when there are none.
export function worstStation(stations) {
  let worst = null;
  for (const s of stations) {
    if (!worst || (SEV[s.store.status] ?? 0) > (SEV[worst.store.status] ?? 0)) worst = s;
  }
  return worst;
}
