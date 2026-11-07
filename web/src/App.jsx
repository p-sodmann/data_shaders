import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createEngine } from './gl/engine.js';
import { HOUSING } from './instruments/registry.js';
import { worstStation } from './station/manager.js';
import { EngineContext, Key, Module, Screen } from './ui/device.jsx';
import { PageView, firstNumbers } from './ui/PageView.jsx';
import { Field } from './ui/service/controls.jsx';
import { addPage, deletePage, movePage, renamePage } from './config/edit.js';

// The service panel (and react-grid-layout with it) loads when the housing is
// first opened; a display on a wall never needs it.
const Workbench = lazy(() => import('./ui/service/Workbench.jsx').then((m) => ({ default: m.Workbench })));

const SPEEDS = [1, 10, 60];
const DEFAULT_CYCLE = 90;
const UNLOCK_HOLD_MS = 2000;
const CONFIRM_MS = 3000;

const toggleFullscreen = () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
};

const noStore = { subscribe: () => () => {}, getSnapshot: () => null };

// The worst state across all stations, for the alarm lamp: store.status, so a
// STALE station darkens it and an external alert lights it amber. Re-renders
// when any station's store notifies.
function useWorstState(list) {
  const subscribe = useCallback(
    (fn) => {
      const offs = list.map((s) => s.store.subscribe(fn));
      return () => offs.forEach((off) => off());
    },
    [list],
  );
  return useSyncExternalStore(subscribe, () => worstStation(list)?.store.status ?? 'NOMINAL');
}

// The header's EXT lamp: alerts that name no station. null without a
// Prometheus station (no lamp), otherwise whether any is firing.
function useDeviceAlerts(manager) {
  return useSyncExternalStore(manager.subscribe, () => {
    const a = manager.device.alerts;
    return a ? a.external.length > 0 : null;
  });
}

// The footer shows at most this many page keys: a window around the current
// page, with a mark on the side where more are hidden. Keys 1–9 reach the
// first nine pages, [ ] and ← → step through all of them.
const PAGE_KEYS = 9;
function pageWindow(pageNo, total) {
  if (total <= PAGE_KEYS) return [0, total];
  const start = Math.min(Math.max(0, pageNo - 1 - (PAGE_KEYS >> 1)), total - PAGE_KEYS);
  return [start, start + PAGE_KEYS];
}

// The stations the current page shows, in panel order. A page that binds none
// (only '*' panels, say) stands for every station.
function stationsOnPage(page, byId, list) {
  const ids = [...new Set(page.panels.map((p) => p.station).filter((id) => id && id !== '*'))];
  const found = ids.map((id) => byId[id]).filter(Boolean);
  return found.length ? found : list;
}

export default function App({ docStore, manager, device }) {
  const doc = useSyncExternalStore(docStore.subscribe, docStore.getDoc);
  const meta = useSyncExternalStore(docStore.subscribe, docStore.getMeta);
  const { list, byId } = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const pages = doc.pages;
  const first = useMemo(() => firstNumbers(pages), [pages]);
  const named = doc.stations.length > 1;

  // The first station drives the clock and the time-base caption.
  const lead = list[0] ?? null;
  const leadStore = lead?.store ?? noStore;
  const snap = useSyncExternalStore(leadStore.subscribe, leadStore.getSnapshot);
  const lamp = useWorstState(list);
  const ext = useDeviceAlerts(manager);
  // The time base (S) only exists for simulated stations; a live one runs at ×1.
  const sim = list.find((s) => s.source.kind === 'SIMULATED') ?? null;
  const simStore = sim?.store ?? noStore;
  const simSnap = useSyncExternalStore(simStore.subscribe, simStore.getSnapshot);

  const canvasRef = useRef(null);
  const [engine, setEngine] = useState(null);
  const [failure, setFailure] = useState(null);
  const [finish, setFinish] = useState(device.finish);
  const [page, setPage] = useState(device.page);
  const [cycle, setCycle] = useState(device.cycle);
  // which of the current page's stations T injects into (Shift+T cycles)
  const [target, setTarget] = useState(0);

  // The service panel (step 08). A locked device (doc.device.locked) only
  // opens after a 2 s press on the SERVICE key, or with ?unlock=1; the
  // long-press unlock lasts until the housing is closed again.
  const [editing, setEditing] = useState(false);
  const [unlocked, setUnlocked] = useState(() => new URLSearchParams(location.search).get('unlock') === '1');
  const urlUnlock = useRef(unlocked).current;
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef(null);
  const [notice, setNotice] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stdOpen, setStdOpen] = useState(false);
  // the stations plate (step 09), and a cartridge file waiting on it to be imported
  const [stationsOpen, setStationsOpen] = useState(false);
  const [cartridge, setCartridge] = useState(null);
  const locked = doc.device.locked && !unlocked;

  // a document edit may remove pages under us
  const pageNo = Math.min(Math.max(1, page), pages.length);
  const current = pages[pageNo - 1];
  const [winStart, winEnd] = pageWindow(pageNo, pages.length);
  const onPage = useMemo(() => stationsOnPage(current, byId, list), [current, byId, list]);
  // only a simulated station can take a test incident
  const testable = useMemo(() => onPage.filter((s) => s.source.kind === 'SIMULATED'), [onPage]);
  const testStation = testable.length ? testable[target % testable.length] : null;

  // The housing tubes are built once on the device view, which always lists
  // the current stations.
  const housing = useMemo(() => ({ status: HOUSING.status(manager.device), clock: HOUSING.clock(manager.device) }), [manager]);

  // Key handlers are bound once; they read the latest values from here.
  const live = useRef(null);
  live.current = { pages, testable, testStation, list, editing, locked };

  useEffect(() => localStorage.setItem('mars.page', pageNo), [pageNo]);
  useEffect(() => setTarget(0), [current.id]);
  // pages don't turn while the housing is open
  useEffect(() => {
    if (!cycle || editing) return undefined;
    const id = setInterval(() => setPage((p) => (p % live.current.pages.length) + 1), cycle * 1000);
    return () => clearInterval(id);
  }, [cycle, editing]);
  useEffect(() => {
    if (!confirmDelete) return undefined;
    const id = setTimeout(() => setConfirmDelete(false), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [confirmDelete]);
  useEffect(() => {
    setRenaming(false);
    setConfirmDelete(false);
  }, [pageNo, editing]);

  useEffect(() => {
    let e = null;
    try {
      e = createEngine(canvasRef.current, { fps: device.fps, dpr: device.dpr });
      setEngine(e);
      // debug hook: live screens and GPU objects, read by the smoke test's page-switch check
      window.__mars = Object.assign(window.__mars ?? {}, { stats: e.stats });
    } catch (err) {
      setFailure(String(err?.message || err));
    }
    return () => e?.destroy();
  }, []);

  useEffect(() => localStorage.setItem('mars.finish', finish), [finish]);

  const actions = useMemo(
    () => ({
      fullscreen: toggleFullscreen,
      test() {
        const s = live.current.testStation;
        if (!s || s.source.kind !== 'SIMULATED') return;
        s.source.triggerIncident();
        s.store.note(1, 'TEST ALARM INJECTED BY OPERATOR');
      },
      target() {
        if (live.current.testable.length > 1) setTarget((t) => t + 1);
      },
      // The time base is one setting for the device: every simulated station follows it.
  // Live stations (Prometheus, poll) ignore it.
      speed() {
        const sims = live.current.list.filter((s) => s.source.kind === 'SIMULATED');
        if (!sims.length) return;
        const next = SPEEDS[(SPEEDS.indexOf(sims[0].source.speed) + 1) % SPEEDS.length];
        for (const s of sims) {
          s.source.setSpeed(next);
          s.store.note(0, `TIME BASE X${next}`);
          s.store.refresh();
        }
      },
      finish: () => setFinish((f) => (f === 'ivory' ? 'graphite' : 'ivory')),
      page: (n) => setPage(n),
      next: () => setPage((p) => (Math.min(p, live.current.pages.length) % live.current.pages.length) + 1),
      prev: () => {
        const n = live.current.pages.length;
        setPage((p) => ((Math.min(p, n) + n - 2) % n) + 1);
      },
      auto: () => setCycle((c) => (c ? 0 : device.cycle || DEFAULT_CYCLE)),
      service() {
        const { editing: open, locked: shut } = live.current;
        if (open) actions.close();
        else if (!shut) setEditing(true);
      },
      close() {
        setEditing(false);
        setStdOpen(false);
        setStationsOpen(false);
        setCartridge(null);
        setNotice(null);
        if (!urlUnlock) setUnlocked(false);
      },
    }),
    [],
  );

  // A document edit from the service panel. The store refuses an invalid
  // document by throwing; the first line of its reason goes on the panel.
  const edit = useCallback(
    (fn) => {
      try {
        docStore.setDoc(fn);
        setNotice(null);
        return true;
      } catch (e) {
        setNotice(String(e.message).split('\n')[0]);
        return false;
      }
    },
    [docStore],
  );

  // SERVICE key: a click toggles the housing; on a locked device only a 2 s
  // press opens it.
  const servicePress = () => {
    if (!locked || editing) return;
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = 'opened';
      setHolding(false);
      setUnlocked(true);
      setEditing(true);
    }, UNLOCK_HOLD_MS);
  };
  // the click that ends a successful long press must not close it again
  const serviceClick = () => {
    if (holdTimer.current === 'opened') holdTimer.current = null;
    else if (!locked) actions.service();
  };
  const serviceRelease = () => {
    if (holdTimer.current !== 'opened') clearTimeout(holdTimer.current);
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const pageOps = {
    add() {
      if (edit((d) => addPage(d))) setPage(pages.length + 1);
    },
    move(dir) {
      let index = pageNo - 1;
      const moved = edit((d) => {
        const r = movePage(d, pageNo - 1, dir);
        index = r.index;
        return r.doc;
      });
      if (moved) setPage(index + 1);
    },
    rename(name) {
      edit((d) => renamePage(d, pageNo - 1, name));
      setRenaming(false);
    },
    remove() {
      if (!confirmDelete) return setConfirmDelete(true);
      setConfirmDelete(false);
      if (edit((d) => deletePage(d, pageNo - 1))) setPage(Math.max(1, pageNo - 1));
    },
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      const { editing: open } = live.current;
      if (open && (e.metaKey || e.ctrlKey) && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) docStore.redo();
        else docStore.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (key === 'e' || (key === 'escape' && open)) {
        e.preventDefault();
        if (key === 'escape') actions.close();
        else actions.service();
        return;
      }
      const fn =
        key === 't' && e.shiftKey
          ? actions.target
          : ({
              f: actions.fullscreen,
              t: actions.test,
              s: actions.speed,
              b: actions.finish,
              a: actions.auto,
              arrowright: actions.next,
              arrowleft: actions.prev,
              ']': actions.next,
              '[': actions.prev,
            }[key] ?? (/^[1-9]$/.test(e.key) && +e.key <= live.current.pages.length ? () => actions.page(+e.key) : null));
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    // hide the pointer when nobody is touching the device
    let idle;
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(idle);
      idle = setTimeout(() => document.body.classList.add('idle'), 2500);
    };
    wake();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', wake);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', wake);
      clearTimeout(idle);
    };
  }, [actions, docStore]);

  // A cartridge file dropped on the open device goes to the stations plate's
  // import summary. Only files: the module bay's own drags carry text, and the
  // deck handles those. Capture phase, so the deck never sees a file.
  const files = (e) => editing && e.dataTransfer?.types?.includes('Files');
  const dropFile = {
    onDragOverCapture(e) {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    async onDropCapture(e) {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      setStdOpen(false);
      setStationsOpen(true);
      setCartridge({ name: file.name, text: await file.text() });
    },
  };

  const nodes = list.reduce((n, s) => n + s.store.hostCount, 0);

  return (
    <EngineContext.Provider value={engine}>
      <div className={`room ${finish}`}>
        <div className="device" onDoubleClick={toggleFullscreen} {...dropFile}>
          <canvas className="gl" ref={canvasRef} />

          <header className="hd">
            <div className="brand">
              <div className="wordmark">MARS</div>
              <div className="brand-sub">
                <b>Monitor Any Remote System</b>
                <span>Model M-01 · Tape Archive Terminal</span>
              </div>
            </div>
            <div className="plate">
              <span className="cap">Station{meta.origin === 'url-local' ? ' · local copy' : ''}</span>
              <span className="plate-val">{named ? `${doc.stations.length} STATIONS` : doc.stations[0].name}</span>
            </div>
            <div className="plate">
              <span className="cap">Page{cycle ? ` · auto ${cycle}s` : ''}</span>
              <span className="plate-val">
                {String(pageNo).padStart(2, '0')} {current.name.toUpperCase()}
              </span>
            </div>
            <div className="hd-right">
              <div className="lampwrap">
                <i className={`lamp ${lamp}`} />
                <span className="cap">Alarm</span>
              </div>
              {ext !== null && (
                <div className="lampwrap" title="Prometheus alerts without a station label">
                  <i className={`lamp ${ext ? 'DEGRADED' : 'NOMINAL'}`} />
                  <span className="cap">Ext</span>
                </div>
              )}
              <Module name="System" className="status-mod">
                <Screen inst={housing.status} />
              </Module>
              <Module name="Local time" className="clock-mod" meta={snap && snap.speed !== 1 ? `×${snap.speed}` : null}>
                <Screen inst={housing.clock} />
              </Module>
            </div>
          </header>

          {editing ? (
            <Suspense fallback={<main className="deck" />}>
              <Workbench
                key={current.id}
                doc={doc}
                meta={meta}
                pageIndex={pageNo - 1}
                stations={byId}
                device={manager.device}
                named={named}
                first={first[pageNo - 1]}
                edit={edit}
                notice={notice}
                onNotice={setNotice}
                store={docStore}
                stdOpen={stdOpen}
                onStdClose={() => setStdOpen(false)}
                onPage={setPage}
                stationsOpen={stationsOpen}
                onStationsToggle={() => {
                  setStationsOpen((o) => !o);
                  setStdOpen(false);
                }}
                cartridge={cartridge}
                onCartridge={setCartridge}
              />
            </Suspense>
          ) : (
            <PageView key={current.id} page={current} stations={byId} device={manager.device} named={named} first={first[pageNo - 1]} />
          )}

          <footer className="ft">
            <div className="keys">
              {winStart > 0 && <button className="keymore" onClick={actions.prev} tabIndex={-1} aria-label={`${winStart} more pages`}>◂</button>}
              {pages.slice(winStart, winEnd).map((p, j) => {
                const i = winStart + j;
                return editing && renaming && pageNo === i + 1 ? (
                  <span key={p.id} className="key latch on renaming">
                    <kbd>{i + 1}</kbd>
                    <Field value={p.name} maxLength={16} autoFocus onCommit={pageOps.rename} onCancel={() => setRenaming(false)} />
                  </span>
                ) : (
                  <Key key={p.id} k={i + 1} onClick={() => actions.page(i + 1)} active={pageNo === i + 1}>
                    {p.name}
                  </Key>
                );
              })}
              {winEnd < pages.length && <button className="keymore" onClick={actions.next} tabIndex={-1} aria-label={`${pages.length - winEnd} more pages`}>▸</button>}
              {editing ? (
                <>
                  <span className="keysep" />
                  <Key k="+" onClick={pageOps.add} className="page-add">New page</Key>
                  <Key k="◀" onClick={() => pageOps.move(-1)} disabled={pageNo === 1} className="page-left" />
                  <Key k="▶" onClick={() => pageOps.move(1)} disabled={pageNo === pages.length} className="page-right" />
                  <Key k="✎" onClick={() => setRenaming(true)} className="page-rename">Rename</Key>
                  <Key k="✕" onClick={pageOps.remove} disabled={pages.length <= 1} className="page-delete">
                    {confirmDelete ? 'Press again' : 'Delete'}
                  </Key>
                  <Key
                    k="▦"
                    onClick={() => {
                      setStdOpen((o) => !o);
                      setStationsOpen(false);
                    }}
                    active={stdOpen}
                    className="page-std"
                  >
                    Std pages
                  </Key>
                </>
              ) : (
                <>
                  <Key k="A" onClick={actions.auto} active={!!cycle}>Auto</Key>
                  <span className="keysep" />
                  <Key k="F" onClick={actions.fullscreen}>Fullscreen</Key>
                  <Key k="T" onClick={actions.test} accent>
                    {onPage.length > 1 && testStation ? `Test · ${testStation.name}` : 'Test alarm'}
                  </Key>
                  <Key k="S" onClick={actions.speed}>{sim ? `Time ×${simSnap?.speed ?? 1}` : 'Time ×1 live'}</Key>
                  <Key k="B" onClick={actions.finish}>Finish</Key>
                </>
              )}
              <span className="keysep" />
              <Key
                k="E"
                className={`service-key${holding ? ' holding' : ''}`}
                active={editing}
                onClick={serviceClick}
                onPointerDown={servicePress}
                onPointerUp={serviceRelease}
                onPointerLeave={serviceRelease}
              >
                {locked ? 'Service · hold' : 'Service'}
              </Key>
            </div>
            <div className="grille" />
            <div className="serial">
              {list.length > 1 ? `${list.length} stations` : `Source ${snap?.kind ?? '–'}`} · {nodes} nodes · SN 0001
            </div>
          </footer>

          {failure && (
            <div className="failure">
              <b>NO PICTURE</b>
              <span>{failure}</span>
            </div>
          )}
        </div>
      </div>
    </EngineContext.Provider>
  );
}
