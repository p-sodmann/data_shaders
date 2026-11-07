import { freeId } from './edit.js';
import { formatIssues, docSchema } from './schema.js';
import { migrate } from './migrations.js';

// Station and cartridge edits for the stations plate (step 09). Like edit.js,
// each one takes a frozen document and returns a new one (or throws a
// readable Error), and the doc store validates the result.

// ---------- stations ----------

// The panels bound to a station, as [{ page, panel }] (page index, panel id).
// '*' bindings stand for every station and aren't counted.
export function stationUsage(doc, id) {
  const out = [];
  doc.pages.forEach((p, pi) => p.panels.forEach((q) => q.station === id && out.push({ page: pi, panel: q.id })));
  return out;
}

const NAME_MAX = 24;
const toId = (value) => String(value).replace(/[^\w.-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 32) || 'station';

// A new entry for a value of Prometheus's `station` label: the value as its id
// (or the next free one), the value upper-cased with "-01" as its name.
export function promStation(doc, value) {
  const id = freeId(doc.stations.map((s) => s.id), toId(value));
  return { id, name: `${value}-01`.toUpperCase().slice(0, NAME_MAX), source: { kind: 'prometheus', station: String(value) } };
}

// The label values that no station of the document reads yet, in their order.
export function unclaimed(doc, values) {
  const taken = new Set(doc.stations.filter((s) => s.source.kind === 'prometheus').map((s) => s.source.station));
  return values.filter((v) => !taken.has(v));
}

export const addStation = (doc, entry) => ({ ...doc, stations: [...doc.stations, entry] });

// A station entry with `patch` applied: a field set to undefined is removed
// (its default applies again), and so is an override object or list left empty.
export function patchStation(entry, patch) {
  const next = { ...entry, ...patch };
  for (const [k, v] of Object.entries(next)) {
    const empty = v && typeof v === 'object' && Object.keys(v).length === 0;
    if (v === undefined || (empty && k !== 'source')) delete next[k];
  }
  return next;
}

export function updateStation(doc, id, patch) {
  if (!doc.stations.some((s) => s.id === id)) throw new Error(`no station "${id}"`);
  return { ...doc, stations: doc.stations.map((s) => (s.id === id ? patchStation(s, patch) : s)) };
}

// Removes a station. Panels bound to it are removed, or bound to `rebind`
// (another station's id) instead.
export function removeStation(doc, id, { rebind = null } = {}) {
  if (doc.stations.length <= 1) throw new Error('the last station cannot be removed');
  if (rebind !== null && (rebind === id || !doc.stations.some((s) => s.id === rebind))) throw new Error(`cannot rebind to "${rebind}"`);
  const pages = doc.pages.map((p) => ({
    ...p,
    panels: rebind === null ? p.panels.filter((q) => q.station !== id) : p.panels.map((q) => (q.station === id ? { ...q, station: rebind } : q)),
  }));
  return { ...doc, stations: doc.stations.filter((s) => s.id !== id), pages };
}

export function setPrometheusUrl(doc, url) {
  const u = url.trim();
  if (!u) throw new Error('the Prometheus URL cannot be empty');
  return { ...doc, prometheus: { ...doc.prometheus, url: u } };
}

// ---------- cartridges ----------

const pad2 = (n) => String(n).padStart(2, '0');
// mars-2026-11-07.mars.json, by the display's local date
export const cartridgeName = (d = new Date()) => `mars-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.mars.json`;

export const cartridgeText = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

// A cartridge file's text → { doc, summary } or { errors: [lines] }. The file
// is migrated and validated like any other document, so an old cartridge
// loads and a broken one says why, one problem per line.
export function readCartridge(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { errors: [`not a JSON file: ${e.message}`] };
  }
  let migrated;
  try {
    migrated = migrate(raw);
  } catch (e) {
    return { errors: [e.message] };
  }
  const r = docSchema.safeParse(migrated);
  if (!r.success) return { errors: formatIssues(r.error).split('\n') };
  const doc = r.data;
  return { doc, summary: { stations: doc.stations.map((s) => s.name), pages: doc.pages.length, version: raw.version ?? 0 } };
}

const sameSource = (a, b) => JSON.stringify(a.source) === JSON.stringify(b.source);

// The incoming cartridge added to the current document. A station with the
// same id and source is the same station: the current entry stays. One with
// the same id but another source gets a free id, and its panels follow.
// Pages are appended (with free ids); device settings and the Prometheus URL
// stay the current document's.
export function mergeDocs(current, incoming) {
  const stations = [...current.stations];
  const rename = new Map();
  for (const s of incoming.stations) {
    const have = stations.find((c) => c.id === s.id);
    if (have && sameSource(have, s)) continue;
    if (have) {
      const id = freeId(stations.map((c) => c.id), s.id);
      rename.set(s.id, id);
      stations.push({ ...s, id });
    } else stations.push(s);
  }
  const pages = [...current.pages];
  for (const p of incoming.pages) {
    const id = freeId(pages.map((q) => q.id), p.id);
    pages.push({ ...p, id, panels: p.panels.map((q) => (rename.has(q.station) ? { ...q, station: rename.get(q.station) } : q)) });
  }
  return { ...current, stations, pages };
}
