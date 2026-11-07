import { prepare, STORAGE_KEY } from './load.js';

// The live config document: a small external store for useSyncExternalStore
// and the station manager.
//
// Every document that goes in is migrated and validated, and comes out deeply
// frozen, so a change always means a new object (updaters return copies) and
// listeners can compare by identity. A document that doesn't validate is
// refused with an Error and the current one stays.
//
// Changes are saved to localStorage[key] after a short pause, unless the
// document came from the URL: a kiosk link must not overwrite what this
// display has saved. save() stores it anyway and makes it this display's own
// (for a ?config= link, a copy under that link's key, which then wins over the
// link on this display; revert() deletes it).
//
// Every accepted change keeps the document it replaced on an undo stack
// (frozen snapshots, so they cost nothing to keep). undo() and redo() step
// through them and are saved like any other change. The stacks are saved too,
// under mars.undo@<key> next to the document they lead to, and come back after
// a reload only if that document is still the one loaded.

const SAVE_DELAY = 500;
const UNDO_DEPTH = 50;
const UNDO_BYTES = 2_000_000; // localStorage holds about 5 MB per origin
export const undoKey = (key) => `mars.undo@${key}`;

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

// the saved stacks, if they lead to `doc`; otherwise none
function restoreHistory(storage, key, doc) {
  try {
    const raw = storage?.getItem(undoKey(key));
    if (!raw) return null;
    const h = JSON.parse(raw);
    if (JSON.stringify(h.head) !== JSON.stringify(doc)) return null;
    const revive = (list) => list.slice(-UNDO_DEPTH).map((d) => deepFreeze(prepare(d)));
    return { past: revive(h.past), future: revive(h.future) };
  } catch {
    return null; // an older or broken history is just dropped
  }
}

export function createDocStore({ doc, origin = 'default', key = STORAGE_KEY, storage = globalThis.localStorage, delay = SAVE_DELAY }) {
  let current = deepFreeze(prepare(doc));
  let readOnly = origin === 'url';
  let timer = null;
  const listeners = new Set();
  const saved = readOnly ? null : restoreHistory(storage, key, current);
  const past = saved?.past ?? [];
  const future = saved?.future ?? [];
  // where the document lives and what can be undone, as one snapshot that
  // changes identity only when one of them changes (useSyncExternalStore)
  let meta = null;
  const refreshMeta = () => {
    meta = Object.freeze({ origin, readOnly, canUndo: past.length > 0, canRedo: future.length > 0 });
  };
  refreshMeta();

  // The history is a convenience: oldest snapshots go first when it is too
  // big, and if it still can't be written the document is saved without it.
  function writeHistory() {
    const head = JSON.stringify(current);
    const p = past.map((d) => JSON.stringify(d)), f = future.map((d) => JSON.stringify(d));
    let size = head.length + p.reduce((a, s) => a + s.length, 0) + f.reduce((a, s) => a + s.length, 0);
    while (size > UNDO_BYTES && p.length) size -= p.shift().length;
    try {
      storage?.setItem(undoKey(key), `{"head":${head},"past":[${p.join(',')}],"future":[${f.join(',')}]}`);
    } catch {
      try {
        storage?.removeItem?.(undoKey(key));
      } catch {
        // nothing to clean up then
      }
    }
  }

  function write() {
    clearTimeout(timer);
    timer = null;
    try {
      storage?.setItem(key, JSON.stringify(current));
    } catch (e) {
      console.warn(`[MARS] config not saved: ${e.message}`);
      return;
    }
    writeHistory();
    // once written, the display's own copy is what a reload finds
    const own = key === STORAGE_KEY ? 'local' : 'url-local';
    if (origin !== own) {
      origin = own;
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
    // Forget this display's copy of a ?config= document, and its history; the
    // caller reloads, and the link's own document comes back.
    revert() {
      if (origin !== 'url-local') return false;
      clearTimeout(timer);
      timer = null;
      readOnly = true;
      try {
        storage?.removeItem(key);
        storage?.removeItem(undoKey(key));
      } catch (e) {
        console.warn(`[MARS] local copy not removed: ${e.message}`);
        return false;
      }
      return true;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
