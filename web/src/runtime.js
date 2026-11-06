import { CONFIG, ROWS, ROW_SECONDS, ALMANAC_DAYS } from './config.js';
import { createSimulatedSource, createHistorySynth } from './data/simulator.js';
import { createAlmanac } from './data/almanac.js';
import { createPollingSource } from './data/polling.js';
import { createTelemetry } from './data/telemetry.js';

export const source =
  CONFIG.source === 'sim'
    ? createSimulatedSource({ hostCount: CONFIG.hosts, speed: CONFIG.speed })
    : createPollingSource({ url: CONFIG.source, hostCount: CONFIG.hosts });

export const store = createTelemetry({
  hostCount: CONFIG.hosts,
  now: source.now,
  kind: source.kind,
  getSpeed: () => source.speed,
});

// The long memory for page 5, kept per source and station.
export const almanac = createAlmanac({ key: `${source.kind}:${CONFIG.source}:${CONFIG.station}` });

// Fill the archive so the tape is meaningful from the first frame.
const archiveStart = Math.floor(source.now() / ROW_SECONDS) * ROW_SECONDS - (ROWS - 1) * ROW_SECONDS;
store.ingest(source.backfill(archiveStart), (x) => almanac.add(x, store.state));

store.note(0, 'MARS M-01 SELF TEST OK');
store.note(0, `SOURCE ${source.kind} ${CONFIG.hosts} NODES`);
if (store.rowStart !== null) store.note(0, `ARCHIVE ${(ROWS * ROW_SECONDS) / 3600}H RESTORED`);

source.start((x) => {
  store.push(x);
  almanac.add(x, store.state);
});

// Restore what this device remembers. A simulated device also gets a
// synthetic past for any minute it never saw, so the almanac is full at once.
const nowMin = Math.floor(source.now() / 60);
almanac.load(nowMin).then((n) => {
  if (n) store.note(0, `ALMANAC ${Math.round(n / 1440)}D RESTORED`);
  if (source.kind === 'SIMULATED') almanac.synthesize(nowMin - ALMANAC_DAYS * 1440 + 1, Math.floor(archiveStart / 60), createHistorySynth());
});
