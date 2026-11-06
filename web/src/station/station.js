import { ROWS, ROW_SECONDS, ALMANAC_DAYS } from '../config.js';
import { createSimulatedSource, createHistorySynth } from '../data/simulator.js';
import { createAlmanac } from '../data/almanac.js';
import { createPollingSource } from '../data/polling.js';
import { createTelemetry } from '../data/telemetry.js';
import { createSignal } from '../data/signal.js';
import { createProfile } from './profile.js';

// One monitored system: its profile, its data source, the telemetry store fed
// by that source, and the long memory (almanac). Instruments are built from a
// station and read everything through it, so several stations can run side by
// side without sharing state.
//
// def = { id, name, source: { kind: 'sim', hosts, seed, speed } | { kind: 'poll', url, hosts }, ...profile overrides }
export function createStation(def) {
  const { source: src = { kind: 'sim' }, ...overrides } = def;
  const profile = createProfile(overrides);
  const hosts = src.hosts ?? 32;

  const source =
    src.kind === 'sim'
      ? createSimulatedSource({ profile, hostCount: hosts, speed: src.speed ?? 1, seed: src.seed })
      : createPollingSource({ profile, url: src.url, hostCount: hosts });

  const store = createTelemetry({
    profile,
    hostCount: hosts,
    now: source.now,
    kind: source.kind,
    getSpeed: () => source.speed,
  });

  // The long memory for page 5, one IndexedDB record per station id and source
  // kind (so a simulated past never shows up as a real one). Before stations had
  // ids the record was keyed by source and name; that one is copied over once.
  const almanac = createAlmanac({
    profile,
    key: `station:${profile.id}:${source.kind}`,
    legacyKey: `${source.kind}:${src.kind === 'sim' ? 'sim' : src.url}:${profile.name}`,
  });

  // The page 4 analyser is costly (FFTs, epoch folding over 4 h), so it exists
  // only while a mounted panel holds a reference (retainSignal). It is derived
  // entirely from the store, so dropping it loses nothing. The drop waits a
  // tick: on a page switch the old page releases before the new one retains,
  // and both may hold the same analyser.
  let signal = null;
  let signalRefs = 0;
  let dropTimer = null;
  let started = false;

  return {
    id: profile.id,
    name: profile.name,
    profile,
    source,
    store,
    almanac,
    get signal() {
      if (!signal) signal = createSignal(store, profile);
      return signal;
    },
    get signalRefs() {
      return signalRefs;
    },
    // returns release()
    retainSignal() {
      signalRefs++;
      clearTimeout(dropTimer);
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        if (--signalRefs === 0) {
          dropTimer = setTimeout(() => {
            if (signalRefs === 0) signal = null;
          }, 0);
        }
      };
    },

    start() {
      if (started) return;
      started = true;

      // Fill the archive so the tape is meaningful from the first frame.
      const archiveStart = Math.floor(source.now() / ROW_SECONDS) * ROW_SECONDS - (ROWS - 1) * ROW_SECONDS;
      store.ingest(source.backfill(archiveStart), (x) => almanac.add(x, store.state));

      store.note(0, 'MARS M-01 SELF TEST OK');
      store.note(0, `SOURCE ${source.kind} ${hosts} NODES`);
      if (store.rowStart !== null) store.note(0, `ARCHIVE ${(ROWS * ROW_SECONDS) / 3600}H RESTORED`);

      source.start((x) => {
        store.push(x);
        almanac.add(x, store.state);
      });

      // Restore what this device remembers. A simulated device also gets a
      // synthetic past for any minute it never saw, so the almanac is full at once.
      const nowMin = Math.floor(source.now() / 60);
      almanac.load(nowMin).then((n) => {
        if (!started) return;
        if (n) store.note(0, `ALMANAC ${Math.round(n / 1440)}D RESTORED`);
        if (source.kind === 'SIMULATED') {
          almanac.synthesize(nowMin - ALMANAC_DAYS * 1440 + 1, Math.floor(archiveStart / 60), createHistorySynth({ seed: src.seed }));
        }
      });
    },

    stop() {
      if (!started) return;
      started = false;
      source.stop();
      almanac.dispose();
      clearTimeout(dropTimer);
      signal = null;
    },
  };
}
