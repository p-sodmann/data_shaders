import { parseDoc } from './schema.js';
import { migrate, legacyDoc, DEFAULT_STATION_NAME } from './migrations.js';
import { DEFAULT_PAGES } from './presets.js';

// Where the device's config document comes from, first match wins (ADR-0005):
//
//   'url'      ?config=<url>, or the legacy station parameters (?source=, ?station=,
//              ?hosts=, ?speed=) read as a v0 document. Both are read-only: the
//              store doesn't save them unless the user asks it to.
//   'local'    localStorage["mars.config"], this display's own copy
//   'server'   /config/mars.json, the Docker config volume
//   'default'  the built-in document
//
// A source that is missing is skipped quietly; one that is there but broken is
// skipped with a problem, so a bad file never leaves the display dark.

export const STORAGE_KEY = 'mars.config';
export const SERVER_URL = '/config/mars.json';

export const defaultDoc = () => ({
  version: 1,
  stations: [{ id: 'main', name: DEFAULT_STATION_NAME, source: { kind: 'sim', hosts: 32 } }],
  pages: DEFAULT_PAGES,
});

// raw JSON value → valid current document; throws with a readable message
export function prepare(raw) {
  const r = parseDoc(migrate(raw));
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

async function fetchJson(fetchFn, url) {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) return { missing: true, status: res.status };
  const text = await res.text();
  // A dev server may answer any path with index.html; that isn't a document.
  if (/^\s*</.test(text)) return { missing: true, status: 'html' };
  return { raw: JSON.parse(text) };
}

export async function loadDoc({ search = '', storage = globalThis.localStorage, fetch: fetchFn = globalThis.fetch } = {}) {
  const q = new URLSearchParams(search);
  const problems = [];
  const attempt = (what, fn) => {
    try {
      return fn();
    } catch (e) {
      problems.push(`${what}: ${e.message}`);
      return null;
    }
  };

  if (q.has('config')) {
    const url = q.get('config');
    try {
      const r = await fetchJson(fetchFn, url);
      if (r.missing) problems.push(`${url}: not found (${r.status})`);
      else {
        const doc = attempt(url, () => prepare(r.raw));
        if (doc) return { doc, origin: 'url', problems };
      }
    } catch (e) {
      problems.push(`${url}: ${e.message}`);
    }
  } else {
    const legacy = legacyDoc(q);
    if (legacy) {
      const doc = attempt('URL parameters', () => prepare(legacy));
      if (doc) return { doc, origin: 'url', problems };
    }
  }

  const stored = attempt('localStorage', () => storage?.getItem(STORAGE_KEY));
  if (stored) {
    const doc = attempt(`localStorage["${STORAGE_KEY}"]`, () => prepare(JSON.parse(stored)));
    if (doc) return { doc, origin: 'local', problems };
  }

  try {
    const r = await fetchJson(fetchFn, SERVER_URL);
    if (!r.missing) {
      const doc = attempt(SERVER_URL, () => prepare(r.raw));
      if (doc) return { doc, origin: 'server', problems };
    }
  } catch (e) {
    problems.push(`${SERVER_URL}: ${e.message}`);
  }

  return { doc: prepare(defaultDoc()), origin: 'default', problems };
}

// Device settings for this session: URL parameters override the document's
// `device` block (and the finish and page this display last showed). They are
// never written back into the document.
export function deviceSettings(doc, { search = '', storage = globalThis.localStorage } = {}) {
  const q = new URLSearchParams(search);
  const num = (key) => {
    const v = parseFloat(q.get(key));
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const stored = (key) => {
    try {
      return storage?.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const finish = [q.get('finish'), stored('mars.finish'), doc.device.finish].find((f) => f === 'ivory' || f === 'graphite');
  return {
    fps: num('fps') || doc.device.fps,
    dpr: num('dpr') || doc.device.dpr,
    cycle: num('cycle') ?? doc.device.cycle,
    finish,
    // 1-based; App clamps it to the document's page count
    page: Math.round(num('page') || +stored('mars.page') || 1),
  };
}
