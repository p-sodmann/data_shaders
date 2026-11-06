import { describe, expect, it, vi } from 'vitest';
import { loadDoc, deviceSettings, STORAGE_KEY, SERVER_URL } from '../src/config/load.js';
import { createDocStore } from '../src/config/store.js';

const docNamed = (name) => ({ version: 1, stations: [{ id: 'main', name, source: { kind: 'sim' } }], pages: [{ id: 'p', name: 'P', panels: [] }] });

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

// a fetch that serves `files` (url → JSON value or raw string) and 404s the rest
function fakeFetch(files = {}) {
  return vi.fn(async (url) => {
    if (!(url in files)) return { ok: false, status: 404, text: async () => '' };
    const body = files[url];
    return { ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  });
}

const nameOf = (r) => r.doc.stations[0].name;

describe('load order', () => {
  const all = {
    storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify(docNamed('LOCAL')) }),
    fetch: fakeFetch({ '/cfg/a.json': docNamed('URL'), [SERVER_URL]: docNamed('SERVER') }),
  };

  it('?config= wins over everything', async () => {
    const r = await loadDoc({ ...all, search: '?config=/cfg/a.json' });
    expect([r.origin, nameOf(r)]).toEqual(['url', 'URL']);
  });

  it('legacy URL parameters come next', async () => {
    const r = await loadDoc({ ...all, search: '?station=old' });
    expect([r.origin, nameOf(r)]).toEqual(['url', 'OLD']);
  });

  it('then localStorage', async () => {
    const r = await loadDoc({ ...all, search: '?fps=30' });
    expect([r.origin, nameOf(r)]).toEqual(['local', 'LOCAL']);
  });

  it('then /config/mars.json', async () => {
    const r = await loadDoc({ storage: memoryStorage(), fetch: all.fetch });
    expect([r.origin, nameOf(r)]).toEqual(['server', 'SERVER']);
  });

  it('then the built-in default', async () => {
    const r = await loadDoc({ storage: memoryStorage(), fetch: fakeFetch() });
    expect([r.origin, nameOf(r), r.doc.pages.length]).toEqual(['default', 'INFERENCE-01', 5]);
    expect(r.problems).toEqual([]);
  });

  it('skips a broken source with a problem instead of failing', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{ not json' });
    const fetch = fakeFetch({ '/bad.json': { version: 1, stations: [] }, [SERVER_URL]: docNamed('SERVER') });
    const r = await loadDoc({ storage, fetch, search: '?config=/bad.json' });
    expect([r.origin, nameOf(r)]).toEqual(['server', 'SERVER']);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toMatch(/^\/bad\.json: stations/);
    expect(r.problems[1]).toMatch(/^localStorage/);
  });

  it('reports a missing ?config= file and survives a network error', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline');
    });
    const r = await loadDoc({ storage: memoryStorage(), fetch, search: '?config=/nope.json' });
    expect(r.origin).toBe('default');
    expect(r.problems).toEqual(['/nope.json: offline', '/config/mars.json: offline']);
  });

  it("doesn't mistake a dev server's index.html for a document", async () => {
    const r = await loadDoc({ storage: memoryStorage(), fetch: fakeFetch({ [SERVER_URL]: '<!doctype html><html>' }) });
    expect(r.origin).toBe('default');
    expect(r.problems).toEqual([]);
  });
});

describe('device settings', () => {
  const doc = { device: { finish: 'graphite', fps: 60, dpr: 2, cycle: 30, locked: false } };

  it('come from the document by default', () => {
    expect(deviceSettings(doc, { storage: memoryStorage() })).toEqual({ fps: 60, dpr: 2, cycle: 30, finish: 'graphite', page: 1 });
  });

  it('are overridden by URL parameters, which beat what the display remembers', () => {
    const storage = memoryStorage({ 'mars.finish': 'graphite', 'mars.page': '3' });
    expect(deviceSettings(doc, { storage, search: '?fps=30&dpr=1&cycle=0&finish=ivory&page=2' })).toEqual({ fps: 30, dpr: 1, cycle: 0, finish: 'ivory', page: 2 });
    expect(deviceSettings(doc, { storage, search: '?finish=nope' })).toMatchObject({ finish: 'graphite', page: 3 });
  });
});

describe('doc store', () => {
  it('validates, freezes and notifies', () => {
    const store = createDocStore({ doc: docNamed('A'), storage: memoryStorage() });
    const seen = vi.fn();
    store.subscribe(seen);
    expect(Object.isFrozen(store.getDoc().stations[0])).toBe(true);
    const next = store.setDoc((d) => ({ ...d, stations: [...d.stations, { id: 'b', name: 'B', source: { kind: 'sim' } }] }));
    expect(next.stations.map((s) => s.id)).toEqual(['main', 'b']);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('refuses an invalid document and keeps the current one', () => {
    const store = createDocStore({ doc: docNamed('A'), storage: memoryStorage() });
    const before = store.getDoc();
    expect(() => store.setDoc((d) => ({ ...d, stations: [] }))).toThrow(/stations/);
    expect(store.getDoc()).toBe(before);
  });

  it('saves changes after a pause', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = createDocStore({ doc: docNamed('A'), origin: 'default', storage, delay: 500 });
    store.setDoc((d) => ({ ...d, device: { ...d.device, fps: 30 } }));
    store.setDoc((d) => ({ ...d, device: { ...d.device, fps: 24 } }));
    expect(storage.map.has(STORAGE_KEY)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(JSON.parse(storage.map.get(STORAGE_KEY)).device.fps).toBe(24);
    vi.useRealTimers();
  });

  it('never saves a document from the URL unless asked to', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = createDocStore({ doc: docNamed('A'), origin: 'url', storage });
    expect(store.readOnly).toBe(true);
    store.setDoc((d) => ({ ...d, device: { ...d.device, fps: 30 } }));
    vi.advanceTimersByTime(5000);
    expect(storage.map.has(STORAGE_KEY)).toBe(false);
    store.save();
    expect([store.readOnly, store.origin]).toEqual([false, 'local']);
    expect(JSON.parse(storage.map.get(STORAGE_KEY)).device.fps).toBe(30);
    vi.useRealTimers();
  });
});
