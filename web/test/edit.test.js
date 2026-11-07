import { describe, expect, it, vi } from 'vitest';
import {
  addPage,
  addPanel,
  addStandardPages,
  deletePage,
  duplicatePanel,
  findSpot,
  fits,
  freeId,
  movePage,
  placeFor,
  placePanels,
  removePanel,
  renamePage,
  swapPanel,
  updatePanel,
} from '../src/config/edit.js';
import { createDocStore } from '../src/config/store.js';
import { defaultDoc, prepare } from '../src/config/load.js';
import { REGISTRY } from '../src/instruments/registry.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m };
};

const two = () =>
  prepare({
    version: 1,
    stations: [
      { id: 'a', name: 'A-01', source: { kind: 'sim' } },
      { id: 'b', name: 'B-01', source: { kind: 'sim' } },
    ],
    pages: [{ id: 'p', name: 'P', panels: [{ id: 'tape', type: 'tape', station: 'a', x: 0, y: 0, w: 8, h: 6, options: {} }] }],
  });

describe('placement', () => {
  const panels = [{ id: 't', x: 0, y: 0, w: 8, h: 6 }];

  it('refuses overlaps and the grid edge', () => {
    expect(fits(panels, { x: 8, y: 0, w: 4, h: 6 })).toBe(true);
    expect(fits(panels, { x: 7, y: 0, w: 4, h: 6 })).toBe(false);
    expect(fits(panels, { x: 9, y: 0, w: 4, h: 2 })).toBe(false);
    expect(fits(panels, { x: 0, y: 7, w: 2, h: 2 })).toBe(false);
    expect(fits(panels, { x: 0, y: 0, w: 8, h: 6 }, 't')).toBe(true); // a panel doesn't collide with itself
  });

  it('finds the first free spot row by row', () => {
    expect(findSpot(panels, 4, 3)).toEqual({ x: 8, y: 0, w: 4, h: 3 });
    expect(findSpot(panels, 5, 2)).toEqual({ x: 0, y: 6, w: 5, h: 2 });
    expect(findSpot(panels, 12, 3)).toBeNull();
  });

  it('shrinks to the minimum when the default size has no room', () => {
    // radar: default 5 × 6, min 3 × 3; the free strip on the right is 4 × 6
    expect(placeFor(panels, REGISTRY.radar)).toEqual({ x: 8, y: 0, w: 4, h: 6 });
    const full = [{ id: 'all', x: 0, y: 0, w: 12, h: 8 }];
    expect(placeFor(full, REGISTRY.readout)).toBeNull();
  });

  it('numbers ids that are taken', () => {
    expect(freeId(['radar'], 'radar')).toBe('radar-2');
    expect(freeId(['radar', 'radar-2'], 'radar')).toBe('radar-3');
    expect(freeId([], 'radar')).toBe('radar');
  });
});

describe('panel edits', () => {
  it('add, move, rebind, remove: every result validates', () => {
    let doc = two();
    const r = addPanel(doc, 0, { type: 'radar', station: 'a', rect: { x: 8, y: 0, w: 4, h: 6 } });
    doc = prepare(r.doc);
    expect(r.id).toBe('radar');
    const moved = placePanels(doc, 0, [
      { id: 'tape', x: 0, y: 0, w: 8, h: 6 },
      { id: 'radar', x: 8, y: 2, w: 4, h: 6 },
    ]);
    expect(moved.pages[0].panels[0]).toBe(doc.pages[0].panels[0]); // unchanged panels keep their object
    doc = prepare(moved);
    expect(doc.pages[0].panels[1]).toMatchObject({ x: 8, y: 2 });
    doc = prepare(updatePanel(doc, 0, 'radar', { station: 'b' }));
    expect(doc.pages[0].panels[1].station).toBe('b');
    doc = prepare(removePanel(doc, 0, 'radar'));
    expect(doc.pages[0].panels.map((p) => p.id)).toEqual(['tape']);
  });

  it('refuses a panel where there is no room', () => {
    expect(() => addPanel(two(), 0, { type: 'meter', station: 'a', rect: { x: 6, y: 0, w: 4, h: 3 } })).toThrow(/no room/);
  });

  it('duplicates into the first free spot, or says why not', () => {
    const doc = prepare(addPanel(two(), 0, { type: 'meter', station: 'b', rect: { x: 8, y: 0, w: 4, h: 3 }, options: { x: 1 } }).doc);
    const r = duplicatePanel(doc, 0, 'meter');
    expect(r.id).toBe('meter-2');
    expect(prepare(r.doc).pages[0].panels[2]).toMatchObject({ type: 'meter', station: 'b', x: 8, y: 3, w: 4, h: 3, options: { x: 1 } });
    expect(() => duplicatePanel(doc, 0, 'tape')).toThrow(/no free 8 × 6 spot/);
  });

  it('swaps the instrument in place, growing it to the new minimum if there is room', () => {
    let doc = prepare(addPanel(two(), 0, { type: 'readout', station: 'a', rect: { x: 0, y: 6, w: 2, h: 2 }, options: { signal: 'errors' } }).doc);
    const swapped = prepare(swapPanel(doc, 0, 'readout', 'log', REGISTRY.log));
    expect(swapped.pages[0].panels[1]).toMatchObject({ id: 'readout', type: 'log', station: 'a', x: 0, y: 6, w: 3, h: 2, options: {} });
    doc = prepare(addPanel(doc, 0, { type: 'readout', station: 'a', rect: { x: 2, y: 6, w: 2, h: 2 } }).doc);
    expect(() => swapPanel(doc, 0, 'readout', 'log', REGISTRY.log)).toThrow(/needs 3 × 2/);
  });

  it("drops the '*' binding when the new instrument needs one station", () => {
    const doc = prepare(addPanel(two(), 0, { type: 'log', station: '*', rect: { x: 0, y: 6, w: 6, h: 2 } }).doc);
    expect(prepare(swapPanel(doc, 0, 'log', 'contacts', REGISTRY.contacts)).pages[0].panels[1].station).toBe('a');
  });
});

describe('page edits', () => {
  it('adds PAGE N, renames, moves and deletes', () => {
    let doc = prepare(addPage(two()));
    expect(doc.pages.at(-1)).toMatchObject({ id: 'page-2', name: 'PAGE 2', panels: [] });
    doc = prepare(renamePage(doc, 1, '  Radar  '));
    expect(doc.pages[1].name).toBe('Radar');
    const moved = movePage(doc, 1, -1);
    expect(moved.index).toBe(0);
    expect(prepare(moved.doc).pages.map((p) => p.id)).toEqual(['page-2', 'p']);
    expect(movePage(doc, 0, -1).index).toBe(0); // already leftmost
    doc = prepare(deletePage(doc, 0));
    expect(doc.pages.map((p) => p.id)).toEqual(['page-2']);
    expect(() => deletePage(doc, 0)).toThrow(/last page/);
  });

  it('has no page cap', () => {
    let doc = two();
    for (let i = 0; i < 14; i++) doc = prepare(addPage(doc));
    expect(doc.pages).toHaveLength(15);
    expect(doc.pages.at(-1).name).toBe('PAGE 15');
  });

  it('adds the standard pages for a station with unique ids', () => {
    let doc = prepare(addStandardPages(two(), 'b'));
    expect(doc.pages.map((p) => p.id)).toEqual(['p', 'b-tape', 'b-orbit', 'b-sweep', 'b-signal', 'b-almanac']);
    expect(doc.pages[1].panels.every((q) => q.station === 'b')).toBe(true);
    // a second set for the same station gets the next free prefix
    doc = prepare({ ...doc, pages: doc.pages.slice(0, 2) });
    expect(prepare(addStandardPages(doc, 'b')).pages.slice(2).map((p) => p.id)).toEqual(['b2-tape', 'b2-orbit', 'b2-sweep', 'b2-signal', 'b2-almanac']);
    // the built-in document's five pages leave room for another set
    expect(prepare(addStandardPages(defaultDoc(), 'main')).pages).toHaveLength(10);
  });
});

describe('undo', () => {
  const store = () => createDocStore({ doc: two(), storage: memoryStorage() });
  const rename = (name) => (d) => renamePage(d, 0, name);

  it('steps back and forward through accepted changes', () => {
    const s = store();
    const first = s.getDoc();
    s.setDoc(rename('ONE'));
    s.setDoc(rename('TWO'));
    expect(s.getMeta()).toMatchObject({ canUndo: true, canRedo: false });
    expect(s.undo().pages[0].name).toBe('ONE');
    expect(s.undo()).toBe(first);
    expect(s.getMeta()).toMatchObject({ canUndo: false, canRedo: true });
    expect(s.undo()).toBe(first); // nothing left: no change
    expect(s.redo().pages[0].name).toBe('ONE');
    s.setDoc(rename('THREE')); // a new change drops the redo branch
    expect(s.getMeta().canRedo).toBe(false);
  });

  it("doesn't record refused changes", () => {
    const s = store();
    expect(() => s.setDoc((d) => ({ ...d, pages: [] }))).toThrow();
    expect(s.getMeta().canUndo).toBe(false);
  });

  it('keeps 50 steps', () => {
    const s = store();
    for (let i = 0; i < 60; i++) s.setDoc(rename(`N${i}`));
    let n = 0;
    while (s.getMeta().canUndo) {
      s.undo();
      n++;
    }
    expect(n).toBe(50);
    expect(s.getDoc().pages[0].name).toBe('N9');
  });

  it('saves an undo like any change, and notifies', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = createDocStore({ doc: two(), storage, delay: 500 });
    const seen = vi.fn();
    s.subscribe(seen);
    s.setDoc(rename('ONE'));
    vi.advanceTimersByTime(500);
    s.undo();
    vi.advanceTimersByTime(500);
    expect(JSON.parse(storage.map.get('mars.config')).pages[0].name).toBe('P');
    expect(seen).toHaveBeenCalled();
    expect(s.getMeta().origin).toBe('local');
    vi.useRealTimers();
  });

  it('a URL document stays unsaved until save(), and the meta snapshot follows', () => {
    const storage = memoryStorage();
    const s = createDocStore({ doc: two(), origin: 'url', storage });
    const m0 = s.getMeta();
    expect(m0).toMatchObject({ origin: 'url', readOnly: true });
    expect(s.getMeta()).toBe(m0); // stable identity between changes
    s.setDoc(rename('ONE'));
    expect(storage.map.size).toBe(0);
    s.save();
    expect(s.getMeta()).toMatchObject({ origin: 'local', readOnly: false });
    expect(JSON.parse(storage.map.get('mars.config')).pages[0].name).toBe('ONE');
  });
});
