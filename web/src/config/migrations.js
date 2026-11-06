import { VERSION } from './schema.js';
import { DEFAULT_PAGES } from './presets.js';

// Documents are migrated forward one version at a time: MIGRATIONS[n] turns a
// version-n document into version n + 1. A document without `version` is v0.
//
// v0 is the device before the config document: one station described by the
// old URL parameters `source`, `station`, `hosts` and `speed`. The loader turns
// such a URL into a v0 document (see legacyDoc), so old kiosk URLs keep working,
// and a v0 JSON file with the same fields loads the same way.

export const DEFAULT_STATION_NAME = 'INFERENCE-01';

const positive = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const MIGRATIONS = [
  // v0 → v1
  (v0) => {
    const hosts = Math.round(positive(v0.hosts) ?? 32);
    const speed = positive(v0.speed);
    const src = v0.source && v0.source !== 'sim' ? String(v0.source) : 'sim';
    return {
      version: 1,
      ...(v0.device && { device: v0.device }),
      stations: [
        {
          id: 'main',
          // the old device upper-cased the name for its plate
          name: String(v0.station || DEFAULT_STATION_NAME).toUpperCase(),
          source: src === 'sim' ? { kind: 'sim', hosts, ...(speed && { speed }) } : { kind: 'poll', url: src, hosts },
        },
      ],
      pages: v0.pages ?? DEFAULT_PAGES,
    };
  },
];

// The URL parameters that described the station before there were documents.
export const LEGACY_PARAMS = ['source', 'station', 'hosts', 'speed'];

// A v0 document from legacy URL parameters, or null if the URL has none.
export function legacyDoc(params) {
  const present = LEGACY_PARAMS.filter((k) => params.has(k));
  if (!present.length) return null;
  return Object.fromEntries(present.map((k) => [k, params.get(k)]));
}

// Brings any known version up to VERSION. Throws on documents from a newer build
// or with a version this build never had.
export function migrate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('a config document is a JSON object');
  let doc = raw;
  let v = doc.version ?? 0;
  if (!Number.isInteger(v) || v < 0) throw new Error(`unknown document version ${JSON.stringify(doc.version)}`);
  if (v > VERSION) throw new Error(`document version ${v} is newer than this display (${VERSION})`);
  for (; v < VERSION; v++) doc = MIGRATIONS[v](doc);
  return doc;
}
