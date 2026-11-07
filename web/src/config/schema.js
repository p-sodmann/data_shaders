import { z } from 'zod';

// The config document ("cartridge"), version 1. See ADR-0005 for the contract.
// Unknown keys are dropped everywhere except in a panel's `options`, which
// belong to the instrument and are kept as they are, so an option this build
// doesn't know survives a load and save.

export const VERSION = 1;
export const GRID = { cols: 12, rows: 8 };

const int = (min, max) => z.number().int().min(min).max(max);

// Station ids end up in panel bindings and IndexedDB keys. '*' is reserved for
// "every station" (see panels below), so ids are plain names.
const stationId = z.string().regex(/^[A-Za-z0-9][\w.-]{0,31}$/, 'letters, digits, _ . - (max 32), not starting with a symbol');

const source = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sim'),
    hosts: int(1, 256).default(32),
    seed: z.number().int().optional(),
    speed: z.number().positive().optional(),
  }),
  // a JSON endpoint polled once per second (data/polling.js)
  z.object({ kind: z.literal('poll'), url: z.string().min(1), hosts: int(1, 256).default(32) }),
  // a station of a Prometheus server (step 07): the value of its `station` label
  z.object({ kind: z.literal('prometheus'), station: z.string().min(1) }),
]);

// Profile overrides (station/profile.js): any field left out keeps the default.
const thresh = z
  .object({
    warn: z.number().positive(),
    crit: z.number().positive(),
    max: z.number().positive(),
    errWarn: z.number().min(0).max(1),
    errCrit: z.number().min(0).max(1),
    errMax: z.number().gt(0).max(1),
    satWarn: z.number().min(0).max(1),
    satCrit: z.number().min(0).max(1),
    tpMax: z.number().positive(),
  })
  .partial();

const station = z.object({
  id: stationId,
  name: z.string().trim().min(1).max(24),
  source,
  thresh: thresh.optional(),
  slo: z.object({ target: z.number().gt(0).lt(1), days: int(1, 30) }).partial().optional(),
  home: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  // Prometheus stations: P95 SLOs (ms) for routes and the order of the pipeline
  // stages, on top of what discovery finds. Other source kinds ignore them.
  endpoints: z.array(z.object({ route: z.string().min(1), slo: z.number().positive() })).optional(),
  stages: z.array(z.string().min(1)).optional(),
});

// one station entry on its own, for the stations plate's field checks
export const stationSchema = station;

const panel = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  // a station id, '*' for every station (instruments with scope 'either' or
  // 'device'), or absent for cross-station instruments
  station: z.string().min(1).optional(),
  x: int(0, GRID.cols - 1),
  y: int(0, GRID.rows - 1),
  w: int(1, GRID.cols),
  h: int(1, GRID.rows),
  options: z.record(z.string(), z.unknown()).default({}),
});

const page = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(16),
  panels: z.array(panel),
});

const device = z.object({
  finish: z.enum(['graphite', 'ivory']).default('graphite'),
  fps: z.number().positive().max(240).default(60),
  dpr: z.number().positive().max(4).default(2),
  cycle: z.number().min(0).default(0), // seconds per page when auto-cycling; 0 = off
  locked: z.boolean().default(false),
});

function duplicates(ids) {
  const seen = new Set();
  return ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const docSchema = z
  .object({
    version: z.literal(VERSION),
    device: device.default(() => device.parse({})),
    prometheus: z.object({ url: z.string().min(1).default('/prom') }).optional(),
    stations: z.array(station).min(1),
    pages: z.array(page).min(1), // keys 1–9 reach the first nine, [ ] and ← → all of them
  })
  .superRefine((doc, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    for (const id of duplicates(doc.stations.map((s) => s.id))) issue(['stations'], `duplicate station id "${id}"`);
    for (const id of duplicates(doc.pages.map((p) => p.id))) issue(['pages'], `duplicate page id "${id}"`);
    doc.pages.forEach((p, pi) => {
      for (const id of duplicates(p.panels.map((q) => q.id))) issue(['pages', pi, 'panels'], `duplicate panel id "${id}"`);
      p.panels.forEach((q, qi) => {
        const path = ['pages', pi, 'panels', qi];
        if (q.x + q.w > GRID.cols) issue(path, `panel "${q.id}" runs past column ${GRID.cols}`);
        if (q.y + q.h > GRID.rows) issue(path, `panel "${q.id}" runs past row ${GRID.rows}`);
        for (const other of p.panels.slice(0, qi)) {
          if (overlaps(q, other)) issue(path, `panel "${q.id}" overlaps "${other.id}"`);
        }
      });
    });
  });

// One line per problem, for console warnings and thrown errors.
export function formatIssues(error) {
  return error.issues.map((i) => `${i.path.join('.') || '(document)'}: ${i.message}`).join('\n');
}

// { ok: true, doc } with defaults filled in, or { ok: false, error } with a readable message.
export function parseDoc(raw) {
  const r = docSchema.safeParse(raw);
  return r.success ? { ok: true, doc: r.data } : { ok: false, error: formatIssues(r.error) };
}
