import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createEngine } from './gl/engine.js';
import { HOUSING } from './instruments/registry.js';
import { worstStation } from './station/manager.js';
import { EngineContext, Module, Screen } from './ui/device.jsx';
import { PageView, firstNumbers } from './ui/PageView.jsx';

const SPEEDS = [1, 10, 60];
const DEFAULT_CYCLE = 90;

function Key({ k, children, onClick, accent, active }) {
  const cls = ['key', accent && 'accent', active !== undefined && 'latch', active && 'on'].filter(Boolean).join(' ');
  return (
    <button className={cls} onClick={onClick} tabIndex={-1}>
      <kbd>{k}</kbd>
      <span>{children}</span>
    </button>
  );
}

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

// The stations the current page shows, in panel order. A page that binds none
// (only '*' panels, say) stands for every station.
function stationsOnPage(page, byId, list) {
  const ids = [...new Set(page.panels.map((p) => p.station).filter((id) => id && id !== '*'))];
  const found = ids.map((id) => byId[id]).filter(Boolean);
  return found.length ? found : list;
}

export default function App({ docStore, manager, device }) {
  const doc = useSyncExternalStore(docStore.subscribe, docStore.getDoc);
  const { list, byId } = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const pages = doc.pages;
  const first = useMemo(() => firstNumbers(pages), [pages]);
  const named = doc.stations.length > 1;

  // The first station drives the clock and the time-base caption.
  const lead = list[0] ?? null;
  const leadStore = lead?.store ?? noStore;
  const snap = useSyncExternalStore(leadStore.subscribe, leadStore.getSnapshot);
  const lamp = useWorstState(list);
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

  // a document edit may remove pages under us
  const pageNo = Math.min(Math.max(1, page), pages.length);
  const current = pages[pageNo - 1];
  const onPage = useMemo(() => stationsOnPage(current, byId, list), [current, byId, list]);
  // only a simulated station can take a test incident
  const testable = useMemo(() => onPage.filter((s) => s.source.kind === 'SIMULATED'), [onPage]);
  const testStation = testable.length ? testable[target % testable.length] : null;

  // The housing tubes are built once on the device view, which always lists
  // the current stations.
  const housing = useMemo(() => ({ status: HOUSING.status(manager.device), clock: HOUSING.clock(manager.device) }), [manager]);

  // Key handlers are bound once; they read the latest values from here.
  const live = useRef(null);
  live.current = { pages, testable, testStation, list };

  useEffect(() => localStorage.setItem('mars.page', pageNo), [pageNo]);
  useEffect(() => setTarget(0), [current.id]);
  useEffect(() => {
    if (!cycle) return undefined;
    const id = setInterval(() => setPage((p) => (p % live.current.pages.length) + 1), cycle * 1000);
    return () => clearInterval(id);
  }, [cycle]);

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
    }),
    [],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
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
  }, [actions]);

  const nodes = list.reduce((n, s) => n + s.store.hostCount, 0);

  return (
    <EngineContext.Provider value={engine}>
      <div className={`room ${finish}`}>
        <div className="device" onDoubleClick={toggleFullscreen}>
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
              <span className="cap">Station</span>
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
              <Module name="System" className="status-mod">
                <Screen inst={housing.status} />
              </Module>
              <Module name="Local time" className="clock-mod" meta={snap && snap.speed !== 1 ? `×${snap.speed}` : null}>
                <Screen inst={housing.clock} />
              </Module>
            </div>
          </header>

          <PageView key={current.id} page={current} stations={byId} device={manager.device} named={named} first={first[pageNo - 1]} />

          <footer className="ft">
            <div className="keys">
              {pages.map((p, i) => (
                <Key key={p.id} k={i + 1} onClick={() => actions.page(i + 1)} active={pageNo === i + 1}>
                  {p.name}
                </Key>
              ))}
              <Key k="A" onClick={actions.auto} active={!!cycle}>Auto</Key>
              <span className="keysep" />
              <Key k="F" onClick={actions.fullscreen}>Fullscreen</Key>
              <Key k="T" onClick={actions.test} accent>
                {onPage.length > 1 && testStation ? `Test · ${testStation.name}` : 'Test alarm'}
              </Key>
              <Key k="S" onClick={actions.speed}>{sim ? `Time ×${simSnap?.speed ?? 1}` : 'Time ×1 live'}</Key>
              <Key k="B" onClick={actions.finish}>Finish</Key>
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
