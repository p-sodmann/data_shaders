import { prepare, STORAGE_KEY } from './load.js';

// The live config document: a small external store for useSyncExternalStore
// and the station manager.
//
// Every document that goes in is migrated and validated, and comes out deeply
// frozen, so a change always means a new object (updaters return copies) and
// listeners can compare by identity. A document that doesn't validate is
// refused with an Error and the current one stays.
//
// Changes are saved to localStorage after a short pause, unless the document
// came from the URL: a kiosk link must not overwrite what this display has
// saved. save() stores it anyway and makes it this display's own.

const SAVE_DELAY = 500;

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

export function createDocStore({ doc, origin = 'default', storage = globalThis.localStorage, delay = SAVE_DELAY }) {
  let current = deepFreeze(prepare(doc));
  let readOnly = origin === 'url';
  let timer = null;
  const listeners = new Set();

  function write() {
    clearTimeout(timer);
    timer = null;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.warn(`[MARS] config not saved: ${e.message}`);
    }
  }

  return {
    getDoc: () => current,
    get origin() {
      return origin;
    },
    get readOnly() {
      return readOnly;
    },
    // next: a document, or (doc) => document
    setDoc(next) {
      const raw = typeof next === 'function' ? next(current) : next;
      current = deepFreeze(prepare(raw));
      if (!readOnly) {
        clearTimeout(timer);
        timer = setTimeout(write, delay);
      }
      listeners.forEach((fn) => fn());
      return current;
    },
    save() {
      readOnly = false;
      origin = 'local';
      write();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
