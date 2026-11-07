import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN, fromLink, listExamples, readExample, saveAsOwn, withoutDocParams } from '../src/config/examples.js';
import { loadDoc, STORAGE_KEY } from '../src/config/load.js';

const PUBLIC = new URL('../public', import.meta.url);
const file = (path) => readFileSync(new URL(`.${path}`, `${PUBLIC}/`), 'utf8');

// serves public/ like the display's Caddy does
const publicFetch = async (url) => {
  try {
    const text = file(url);
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, status: 404 };
  }
};

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('example layouts', () => {
  it('lists every shipped example, and each one loads', async () => {
    const list = await listExamples(publicFetch);
    expect(list.map((e) => e.id)).toEqual(['two-stations.json', 'sixteen-stations.json', 'linux-fleet.json', 'builtin']);
    for (const e of list) {
      const r = await readExample(e, publicFetch);
      expect(r.errors, e.id).toBeUndefined();
      expect(r.summary.pages).toBeGreaterThan(0);
    }
  });

  it('offers the built-in document without an index', async () => {
    const list = await listExamples(async () => ({ ok: false, status: 404 }));
    expect(list).toEqual([BUILTIN]);
  });

  it('says why a broken example cannot load', async () => {
    const r = await readExample({ id: 'x', url: '/examples/missing.json' }, publicFetch);
    expect(r.errors[0]).toMatch(/not found \(404\)/);
  });

  it('saved as its own, an example outlives leaving the link', async () => {
    expect(fromLink('url')).toBe(true);
    expect(fromLink('url-local')).toBe(true);
    expect(fromLink('local')).toBe(false);
    const href = 'http://mars:8080/?config=/examples/two-stations.json&finish=ivory&source=sim';
    expect(withoutDocParams(href)).toBe('http://mars:8080/?finish=ivory');

    const storage = memoryStorage();
    const { doc } = await readExample({ id: 'linux-fleet.json', url: '/examples/linux-fleet.json' }, publicFetch);
    expect(saveAsOwn(doc, storage)).toBe(true);
    const loaded = await loadDoc({ search: '?finish=ivory', storage, fetch: publicFetch });
    expect(loaded.origin).toBe('local');
    expect(loaded.doc.stations.map((s) => s.id)).toEqual(doc.stations.map((s) => s.id));
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).pages.length).toBe(doc.pages.length);
  });

  it('reports a storage that refuses', () => {
    const full = { setItem: () => { throw new Error('quota'); } };
    expect(saveAsOwn({}, full)).toBe(false);
  });
});
