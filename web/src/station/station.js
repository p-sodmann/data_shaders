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

  // The long memory for page 5, kept per source and station. The key format
  // predates stations; keep it so saved IndexedDB history still matches.
  const almanac = createAlmanac({ profile, key: `${source.kind}:${src.kind === 'sim' ? 'sim' : src.url}:${profile.name}` });

  let signal = null;
  let started = false;

  return {
    id: profile.id,
    name: profile.name,
    profile,
    source,
    store,
    almanac,
    // the page 4 analyser is costly to set up, so only stations that show it pay for it
    get signal() {
      if (!signal) signal = createSignal(store, profile);
      return signal;
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
    },
  };
}
