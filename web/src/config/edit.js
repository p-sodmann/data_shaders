import { GRID } from './schema.js';
import { standardPages } from './presets.js';

// Document edits for the service panel (step 08). Each one takes a frozen
// document and returns a new one (or throws a readable Error); the doc store
// validates the result, so these only have to get the intent right. Pages are
// addressed by index, panels by id within their page.

export const MAX_PAGES = 9;

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= GRID.cols && r.y + r.h <= GRID.rows;

// Can a rectangle go here without leaving the grid or covering another panel?
export function fits(panels, rect, exceptId = null) {
  return inside(rect) && !panels.some((p) => p.id !== exceptId && overlaps(p, rect));
}

// The first free spot (row by row, left to right) for a w × h rectangle, or null.
export function findSpot(panels, w, h) {
  for (let y = 0; y + h <= GRID.rows; y++) {
    for (let x = 0; x + w <= GRID.cols; x++) if (fits(panels, { x, y, w, h })) return { x, y, w, h };
  }
  return null;
}

// Where an instrument goes when it is clicked in the bay: its default size if
// that fits anywhere, otherwise the largest size down to its minimum that does
// (widest first, then tallest). null when the page has no room for it at all.
export function placeFor(panels, def) {
  const [dw, dh] = def.defaultSize;
  const exact = findSpot(panels, dw, dh);
  if (exact) return exact;
  for (let w = dw; w >= def.minW; w--) {
    for (let h = dh; h >= def.minH; h--) {
      const spot = findSpot(panels, w, h);
      if (spot) return spot;
    }
  }
  return null;
}

// "radar", then "radar-2", "radar-3", … within one page.
export function freeId(taken, base) {
  const ids = new Set(taken);
  if (!ids.has(base)) return base;
  for (let n = 2; ; n++) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
}

const mapPage = (doc, pi, fn) => ({ ...doc, pages: doc.pages.map((p, i) => (i === pi ? fn(p) : p)) });
const mapPanel = (doc, pi, id, fn) => mapPage(doc, pi, (p) => ({ ...p, panels: p.panels.map((q) => (q.id === id ? fn(q) : q)) }));

// ---------- panels ----------

export function addPanel(doc, pi, { type, station, rect, options = {} }) {
  const page = doc.pages[pi];
  if (!fits(page.panels, rect)) throw new Error('no room there');
  const panel = { id: freeId(page.panels.map((q) => q.id), type), type, station, ...rect, options };
  if (station === undefined) delete panel.station;
  return { doc: mapPage(doc, pi, (p) => ({ ...p, panels: [...p.panels, panel] })), id: panel.id };
}

// moves: [{ id, x, y, w, h }]; panels not listed (or unchanged) stay as they are
export function placePanels(doc, pi, moves) {
  const by = new Map(moves.map((m) => [m.id, m]));
  return mapPage(doc, pi, (p) => ({
    ...p,
    panels: p.panels.map((q) => {
      const m = by.get(q.id);
      if (!m || (m.x === q.x && m.y === q.y && m.w === q.w && m.h === q.h)) return q;
      return { ...q, x: m.x, y: m.y, w: m.w, h: m.h };
    }),
  }));
}

export const updatePanel = (doc, pi, id, patch) => mapPanel(doc, pi, id, (q) => ({ ...q, ...patch }));

export const removePanel = (doc, pi, id) => mapPage(doc, pi, (p) => ({ ...p, panels: p.panels.filter((q) => q.id !== id) }));

// A copy of the panel, same size, in the first free spot.
export function duplicatePanel(doc, pi, id) {
  const src = doc.pages[pi].panels.find((q) => q.id === id);
  const spot = findSpot(doc.pages[pi].panels, src.w, src.h);
  if (!spot) throw new Error(`no free ${src.w} × ${src.h} spot on this page`);
  return addPanel(doc, pi, { type: src.type, station: src.station, rect: spot, options: src.options });
}

// Another instrument in the same place. Options belong to the old instrument,
// so they are dropped. A panel smaller than the new instrument's minimum grows
// to it if the cells next to it are free.
export function swapPanel(doc, pi, id, type, def) {
  const page = doc.pages[pi];
  const q = page.panels.find((p) => p.id === id);
  const rect = { x: q.x, y: q.y, w: Math.max(q.w, def.minW), h: Math.max(q.h, def.minH) };
  if (!fits(page.panels, rect, id)) throw new Error(`${type} needs ${def.minW} × ${def.minH} cells here`);
  let station = q.station;
  if (def.scope === 'device') station = undefined;
  else if (station === '*' && def.scope !== 'either') station = undefined;
  const panel = { ...q, ...rect, type, options: {}, station: station ?? firstStation(doc, def) };
  if (panel.station === undefined) delete panel.station;
  return mapPanel(doc, pi, id, () => panel);
}

// The binding a fresh panel of this instrument gets.
export function firstStation(doc, def) {
  return def.scope === 'device' ? undefined : doc.stations[0].id;
}

// ---------- pages ----------

export function addPage(doc) {
  if (doc.pages.length >= MAX_PAGES) throw new Error(`a device has at most ${MAX_PAGES} pages`);
  const n = doc.pages.length + 1;
  const id = freeId(doc.pages.map((p) => p.id), `page-${n}`);
  return { ...doc, pages: [...doc.pages, { id, name: `PAGE ${n}`, panels: [] }] };
}

export const renamePage = (doc, pi, name) => mapPage(doc, pi, (p) => ({ ...p, name: name.trim() }));

// dir: -1 (left) or +1 (right); returns the page's new index with the document
export function movePage(doc, pi, dir) {
  const to = pi + dir;
  if (to < 0 || to >= doc.pages.length) return { doc, index: pi };
  const pages = [...doc.pages];
  [pages[pi], pages[to]] = [pages[to], pages[pi]];
  return { doc: { ...doc, pages }, index: to };
}

export function deletePage(doc, pi) {
  if (doc.pages.length <= 1) throw new Error('the last page cannot be removed');
  return { ...doc, pages: doc.pages.filter((_, i) => i !== pi) };
}

// The five standard pages bound to one station, appended. Page ids get the
// station id as a prefix (and a number if that is taken too).
export function addStandardPages(doc, stationId) {
  const fresh = standardPages(stationId);
  if (doc.pages.length + fresh.length > MAX_PAGES) {
    throw new Error(`no room for ${fresh.length} more pages (${doc.pages.length} of ${MAX_PAGES} used)`);
  }
  const taken = new Set(doc.pages.map((p) => p.id));
  let prefix = `${stationId}-`;
  for (let n = 2; fresh.some((p) => taken.has(prefix + p.id)); n++) prefix = `${stationId}${n}-`;
  return { ...doc, pages: [...doc.pages, ...standardPages(stationId, prefix)] };
}

export const setLocked = (doc, locked) => ({ ...doc, device: { ...doc.device, locked } });
