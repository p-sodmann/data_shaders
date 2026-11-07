import { ROWS, ROW_SECONDS, ALMANAC_DAYS } from '../config.js';
import { createSimulatedSource, createHistorySynth } from '../data/simulator.js';
import { createAlmanac } from '../data/almanac.js';
import { createPollingSource } from '../data/polling.js';
import { createTelemetry } from '../data/telemetry.js';
import { createSignal } from '../data/signal.js';
import { createPromClient } from '../data/prometheus/client.js';
import { discover, defaultSlo } from '../data/prometheus/discover.js';
import { createPrometheusSource } from '../data/prometheus/source.js';
import { createProfile } from './profile.js';

// One monitored system: its profile, its data source, the telemetry store fed
// by that source, and the long memory (almanac). Instruments are built from a
// station and read everything through it, so several stations can run side by
// side without sharing state.
//
// def = { id, name, source, ...profile overrides }, source one of
//   { kind: 'sim', hosts, seed, speed } | { kind: 'poll', url, hosts } | { kind: 'prometheus', station }
// ctx = { prometheus: base URL of the Prometheus API proxy, fetch? }
//
// Starting is asynchronous: a source fills the tape (backfill) before it goes
// live, and a Prometheus station first discovers what it is made of. Until then
// the station is in phase 'load' and its panels show TAPE LOAD instead of their
// instruments (ui/PageView.jsx). Each station starts on its own, so a slow
// backend never holds up the others.
//
// A Prometheus station can be rebuilt while it runs (a label turned up and its
// table had no slot left, ADR-0007): it rediscovers, gets a new store and
// refills the tape. `generation` counts these; profile, source and store are
// getters, so anything that reads them later sees the new ones, and panels
// rebuild their instruments when the generation changes.

// Spare slots a discovered table gets on top of what discovery found. They
// double with every rebuild, and after MAX_REBUILDS a station stops
// rebuilding and leaves the overflow showing, so labels that discovery can't
// see (but the live query can) never send it round in circles.
const SPARE = { nodes: 8, endpoints: 8, stages: 4, regions: 8 };
const MAX_REBUILDS = 4;
// Discovery retries while the backend is unreachable.
const RETRY_MS = [2000, 5000, 10000, 30000];

const archiveStartOf = (now) => Math.floor(now / ROW_SECONDS) * ROW_SECONDS - (ROWS - 1) * ROW_SECONDS;

export function createStation(def, ctx = {}) {
  const { source: src = { kind: 'sim' }, endpoints: epOverride, stages: stOverride, ...rest } = def;
  let overrides = rest; // retune() replaces its thresholds
  const prom = src.kind === 'prometheus';
  const client = prom ? createPromClient({ url: ctx.prometheus ?? '/prom', fetch: ctx.fetch }) : null;

  // what the current generation is built of
  let profile, source, store;
  let signal = null;
  let signalRefs = 0;
  let dropTimer = null;
  let started = false;
  let run = 0; // bumped on stop and rebuild, so an older start() gives up
  let rebuilds = 0;

  const listeners = new Set();
  let status = Object.freeze({ phase: 'load', progress: 0, problem: null, generation: 0 });
  function setStatus(patch) {
    status = Object.freeze({ ...status, ...patch });
    listeners.forEach((fn) => fn());
  }

  function build(found) {
    if (!prom) {
      const hosts = src.hosts ?? 32;
      profile = createProfile(overrides);
      source =
        src.kind === 'sim'
          ? createSimulatedSource({ profile, hostCount: hosts, speed: src.speed ?? 1, seed: src.seed })
          : createPollingSource({ profile, url: src.url, hostCount: hosts });
      store = makeStore(hosts);
      return;
    }
    // Before discovery a Prometheus station has empty tables: a placeholder that
    // the lamp and the housing can read while the tape loads.
    const f = found ?? { nodes: [], endpoints: [], stages: [], stageShare: [], regions: [] };
    const base = createProfile(overrides);
    profile = createProfile({
      ...overrides,
      // one service, the station itself: Prometheus knows nodes, not a topology
      services: [base.name.toUpperCase()],
      hub: 0,
      links: [],
      stages: f.stages,
      stageShare: f.stageShare,
      endpoints: f.endpoints.map((e) => [e.route, 0, e.source === 'doc' ? e.slo : defaultSlo(e.observed ?? base.thresh.warn, base.thresh.warn), e.source === 'auto']),
      regions: f.regions.map((r) => [r.code, r.name, r.lat, r.lon, 0]),
    });
    source = createPrometheusSource({ client, station: src.station, profile, onOverflow: () => rebuild() });
    const k = 2 ** rebuilds;
    const caps = found
      ? {
          nodes: f.nodes.length + Math.max(SPARE.nodes * k, f.nodes.length),
          endpoints: f.endpoints.length + SPARE.endpoints * k,
          stages: f.stages.length + SPARE.stages * k,
          regions: f.regions.length + SPARE.regions * k,
        }
      : {};
    store = makeStore(f.nodes.length, caps, f.nodes);
  }

  function makeStore(hosts, caps, nodeNames) {
    return createTelemetry({
      profile,
      hostCount: hosts,
      now: source.now,
      kind: source.kind,
      getSpeed: () => source.speed,
      caps,
      nodeNames,
    });
  }

  build(null);

  // The long memory for page 5, one IndexedDB record per station id and source
  // kind (so a simulated past never shows up as a real one). Before stations had
  // ids the record was keyed by source and name; that one is copied over once.
  // It outlives rebuilds: it only needs the thresholds and the SLO.
  const almanac = createAlmanac({
    profile,
    key: `station:${profile.id}:${source.kind}`,
    legacyKey: prom ? null : `${source.kind}:${src.kind === 'sim' ? 'sim' : src.url}:${profile.name}`,
  });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function discoverUntilFound(token) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await discover(client, src.station, { endpoints: epOverride, stages: stOverride });
      } catch (e) {
        if (token !== run) return null;
        console.warn(`[MARS] station "${def.id}": discovery failed (${e.message}), retrying`);
        setStatus({ problem: 'NO CONTACT' });
        store.setStale(true);
        await wait(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
        if (token !== run) return null;
      }
    }
  }

  // Discovery (Prometheus), then the tape, then live. `first` is the boot of
  // the station rather than a rebuild: only then are the almanac and the
  // self-test notes loaded.
  async function bringUp(token, first) {
    setStatus({ phase: 'load', progress: 0, problem: null });
    if (prom) {
      const found = await discoverUntilFound(token);
      if (!found) return;
      build(found);
      // the C&W panel keeps showing that the tables overflowed once (ADR-0007)
      store.rebuilds = rebuilds;
      signal = null;
      setStatus({ generation: status.generation + 1, problem: null });
    }

    // A backend's clock decides what "now" is for its data (prometheus/source.js).
    if (source.sync) {
      try {
        const skew = await source.sync();
        if (token !== run) return;
        if (Math.abs(skew) > 2) store.note(1, `CLOCK SKEW ${skew > 0 ? '+' : ''}${Math.round(skew)}S PROMETHEUS`);
      } catch {
        // the backfill below fails the same way and says so
      }
    }

    // Fill the archive so the tape is meaningful from the first frame.
    const archiveStart = archiveStartOf(source.now());
    let samples;
    try {
      samples = await source.backfill(archiveStart, (p) => token === run && setStatus({ progress: p }), store);
    } catch (e) {
      // no tape, but the station still goes live: the gap is honest
      console.warn(`[MARS] station "${def.id}": backfill failed (${e.message})`);
      samples = [];
    }
    if (token !== run) return;
    store.ingest(samples, first ? (x) => almanac.add(x, store.state) : null);

    if (first) {
      store.note(0, 'MARS M-01 SELF TEST OK');
      store.note(0, prom ? `SOURCE PROMETHEUS ${src.station} ${store.hostCount} NODES` : `SOURCE ${source.kind} ${store.hostCount} NODES`);
    } else {
      store.note(1, 'TABLES REBUILT NEW LABELS');
    }
    if (store.rowStart !== null) store.note(0, `ARCHIVE ${(ROWS * ROW_SECONDS) / 3600}H RESTORED`);

    source.start((x) => {
      store.push(x);
      almanac.add(x, store.state);
    }, store);
    setStatus({ phase: 'live', progress: 1 });

    if (first) restoreAlmanac(token, archiveStart);
  }

  // Restore what this device remembers. A simulated device also gets a
  // synthetic past for any minute it never saw, so the almanac is full at once;
  // a Prometheus station asks Prometheus for the minutes it is missing
  // (IndexedDB is only a cache of that).
  async function restoreAlmanac(token, archiveStart) {
    const nowMin = Math.floor(source.now() / 60);
    const n = await almanac.load(nowMin);
    if (token !== run) return;
    if (n) store.note(0, `ALMANAC ${Math.round(n / 1440)}D RESTORED`);
    const from = nowMin - ALMANAC_DAYS * 1440 + 1, to = Math.floor(archiveStart / 60);
    if (source.kind === 'SIMULATED') {
      almanac.synthesize(from, to, createHistorySynth({ seed: src.seed }));
    } else if (prom) {
      const gap = almanac.firstGap(from, to);
      if (gap < 0) return;
      try {
        const got = almanac.fill(await source.history(gap, to));
        if (token === run && got) store.note(0, `ALMANAC ${(got / 1440).toFixed(1)}D FROM PROMETHEUS`);
      } catch (e) {
        console.warn(`[MARS] station "${def.id}": almanac history failed (${e.message})`);
      }
    }
  }

  function rebuild() {
    if (!started) return;
    if (rebuilds >= MAX_REBUILDS) {
      store.note(2, 'SLOTS FULL REBUILD LIMIT RELOAD PAGE');
      return;
    }
    const token = ++run;
    rebuilds++;
    source.stop();
    // after the current poll returns, not inside it
    setTimeout(() => token === run && bringUp(token, false), 0);
  }

  return {
    id: profile.id,
    name: profile.name,
    get profile() {
      return profile;
    },
    get source() {
      return source;
    },
    get store() {
      return store;
    },
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

    // New thresholds without a rebuild (the stations plate, step 09): the
    // profile is made again with them, the store, source and almanac judge by
    // them from the next sample, and panels build their instruments again (a
    // new generation) on the same tape. Any other change to the entry still
    // replaces the station (manager.js).
    retune(next) {
      overrides = { ...overrides, thresh: next.thresh };
      profile = createProfile({ ...profile, thresh: next.thresh });
      store.retune(profile);
      source.retune?.(profile);
      almanac.retune(profile);
      signal = null;
      setStatus({ generation: status.generation + 1 });
    },

    // { phase: 'load' | 'live', progress 0..1, problem, generation }, frozen;
    // a new object on every change (for useSyncExternalStore)
    getStatus: () => status,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // resolves once the station is live (or was stopped on the way)
    start() {
      if (started) return Promise.resolve();
      started = true;
      return bringUp(++run, true);
    },

    stop() {
      if (!started) return;
      started = false;
      run++;
      source.stop();
      almanac.dispose();
      clearTimeout(dropTimer);
      signal = null;
    },
  };
}
