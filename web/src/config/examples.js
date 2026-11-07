import { defaultDoc, prepare, STORAGE_KEY } from './load.js';
import { LEGACY_PARAMS } from './migrations.js';
import { readCartridge } from './stations.js';

// Example layouts (the layouts plate): the documents shipped in
// public/examples/, listed in its index.json, plus the built-in document.
// Loading one makes it this display's own document, saved like any edit, so
// it is what the display shows after a reload, not a ?config= link to the
// example (which stays read-only).

export const EXAMPLES_URL = '/examples/index.json';
export const BUILTIN = { id: 'builtin', title: 'Built-in', description: 'The five standard pages on one simulated station' };

// the examples the server offers, the built-in document last; the index
// itself may be missing (a dev build without it): then only the built-in
export async function listExamples(fetchFn = globalThis.fetch) {
  let entries = [];
  try {
    const res = await fetchFn(EXAMPLES_URL, { cache: 'no-store' });
    if (res.ok) entries = (await res.json()).examples ?? [];
  } catch {
    // only the built-in, then
  }
  const base = EXAMPLES_URL.slice(0, EXAMPLES_URL.lastIndexOf('/') + 1);
  return [...entries.filter((e) => e?.file).map((e) => ({ id: e.file, title: e.title ?? e.file, description: e.description ?? '', url: base + e.file })), BUILTIN];
}

// an example as a checked cartridge: { doc, summary } or { errors }
export async function readExample(entry, fetchFn = globalThis.fetch) {
  if (entry.id === BUILTIN.id) return readCartridge(JSON.stringify(prepare(defaultDoc())));
  try {
    const res = await fetchFn(entry.url, { cache: 'no-store' });
    if (!res.ok) return { errors: [`${entry.url}: not found (${res.status})`] };
    return readCartridge(await res.text());
  } catch (e) {
    return { errors: [`${entry.url}: ${e.message}`] };
  }
}

// URL parameters that pick the document (ADR-0005). While one is in the
// address, a reload would show that document again, not the display's own.
const DOC_PARAMS = ['config', ...LEGACY_PARAMS];

// Does adopting a document mean leaving the address it was loaded from?
export const fromLink = (origin) => origin === 'url' || origin === 'url-local';

// the current address without the document parameters (others, like the
// finish, stay)
export function withoutDocParams(href) {
  const url = new URL(href);
  for (const p of DOC_PARAMS) url.searchParams.delete(p);
  return url.toString();
}

// Saves `doc` as the display's own document, for a display that showed a
// link: the caller then goes to withoutDocParams(location.href), where the
// load order finds it. Returns false if it couldn't be written.
export function saveAsOwn(doc, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return true;
  } catch (e) {
    console.warn(`[MARS] layout not saved: ${e.message}`);
    return false;
  }
}
