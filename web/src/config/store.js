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
//
// Every accepted change keeps the document it replaced on an undo stack
// (frozen snapshots, so they cost nothing to keep). undo() and redo() step
// through them and are saved like any other change.

const SAVE_DELAY = 500;
const UNDO_DEPTH = 50;

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
  const past = [];
  const future = [];
  // where the document lives and what can be undone, as one snapshot that
  // changes identity only when one of them changes (useSyncExternalStore)
  let meta = null;
  const refreshMeta = () => {
    meta = Object.freeze({ origin, readOnly, canUndo: past.length > 0, canRedo: future.length > 0 });
  };
  refreshMeta();

  function write() {
    clearTimeout(timer);
    timer = null;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.warn(`[MARS] config not saved: ${e.message}`);
      return;
    }
    // once written, the display's own copy is what a reload finds
    if (origin !== 'local') {
      origin = 'local';
      refreshMeta();
      listeners.forEach((fn) => fn());
    }
  }

  // make `doc` current, schedule the save and tell everyone
  function commit(doc) {
    current = doc;
    refreshMeta();
    if (!readOnly) {
      clearTimeout(timer);
      timer = setTimeout(write, delay);
    }
    listeners.forEach((fn) => fn());
    return current;
  }

  return {
    getDoc: () => current,
    getMeta: () => meta,
    get origin() {
      return origin;
    },
    get readOnly() {
      return readOnly;
    },
    // next: a document, or (doc) => document
    setDoc(next) {
      const raw = typeof next === 'function' ? next(current) : next;
      const doc = deepFreeze(prepare(raw));
      past.push(current);
      if (past.length > UNDO_DEPTH) past.shift();
      future.length = 0;
      return commit(doc);
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    undo() {
      if (!past.length) return current;
      future.push(current);
      return commit(past.pop());
    },
    redo() {
      if (!future.length) return current;
      past.push(current);
      return commit(future.pop());
    },
    save() {
      readOnly = false;
      write();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
