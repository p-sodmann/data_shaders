import { createStation } from './station.js';

// Keeps one running station per entry of the document's `stations`.
//
// sync(defs) diffs by id: new ids are created and started, missing ids are
// stopped (which saves and closes their almanac), and an entry that changed in
// any way is replaced by a new station. A profile is frozen and instruments copy
// what they need when they are built, so there is nothing to patch in place;
// panels bound to a replaced station rebuild because the station object changed.
//
// Source kinds that this build can't run yet (prometheus, step 07) get no
// station, so their panels show NO SIGNAL.

const RUNNABLE = new Set(['sim', 'poll']);
const SEV = { NOMINAL: 0, DEGRADED: 1, INCIDENT: 2 };

export function createStationManager({ create = createStation } = {}) {
  let entries = new Map(); // id → { key, station }
  let snapshot = { list: Object.freeze([]), byId: Object.freeze({}) };
  const listeners = new Set();
  const skipped = new Set();

  // The device as cross-station instruments see it: always the current list.
  // One object for the whole session, so instruments built on it never need
  // rebuilding when stations come and go.
  const device = Object.freeze({
    get stations() {
      return snapshot.list;
    },
  });

  function sync(defs) {
    const next = new Map();
    let changed = false;
    for (const def of defs) {
      if (!RUNNABLE.has(def.source.kind)) {
        if (!skipped.has(def.id)) console.warn(`[MARS] station "${def.id}": source kind "${def.source.kind}" is not supported yet`);
        skipped.add(def.id);
        continue;
      }
      skipped.delete(def.id);
      const key = JSON.stringify(def);
      const old = entries.get(def.id);
      if (old && old.key === key) {
        next.set(def.id, old);
        continue;
      }
      const station = create(def);
      station.start();
      next.set(def.id, { key, station });
      changed = true;
    }
    for (const [id, { station }] of entries) {
      if (next.get(id)?.station !== station) {
        station.stop();
        changed = true;
      }
    }
    // doc order matters (first station drives the clock), so compare it too
    const order = (m) => [...m.keys()].join('\0');
    if (order(next) !== order(entries)) changed = true;
    entries = next;
    if (changed) {
      const list = [...entries.values()].map((e) => e.station);
      snapshot = { list: Object.freeze(list), byId: Object.freeze(Object.fromEntries(list.map((s) => [s.id, s]))) };
      listeners.forEach((fn) => fn());
    }
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
      for (const { station } of entries.values()) station.stop();
      entries = new Map();
      snapshot = { list: Object.freeze([]), byId: Object.freeze({}) };
      listeners.forEach((fn) => fn());
    },
  };
}

// The station in the worst state; the first one in document order on a tie,
// so the readout doesn't flicker between equals. null when there are none.
export function worstStation(stations) {
  let worst = null;
  for (const s of stations) {
    if (!worst || (SEV[s.store.state] ?? 0) > (SEV[worst.store.state] ?? 0)) worst = s;
  }
  return worst;
}
