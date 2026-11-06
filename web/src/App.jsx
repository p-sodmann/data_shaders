import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CONFIG } from './config.js';
import { station } from './runtime.js';
import { createEngine } from './gl/engine.js';
import { HOUSING } from './instruments/registry.js';
import { DEFAULT_PAGES } from './config/presets.js';
import { EngineContext, Module, Screen } from './ui/device.jsx';
import { PageView, firstNumbers } from './ui/PageView.jsx';

const SPEEDS = [1, 10, 60];
// Step 06 loads the pages and stations from the config document.
const PAGES = DEFAULT_PAGES;
const FIRST = firstNumbers(PAGES);
const STATIONS = { [station.id]: station };
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

export default function App() {
  const { store, source } = station;
  const canvasRef = useRef(null);
  const [engine, setEngine] = useState(null);
  const [failure, setFailure] = useState(null);
  const [finish, setFinish] = useState(() => localStorage.getItem('mars.finish') || CONFIG.finish);
  const [page, setPage] = useState(() => {
    const p = CONFIG.page || +localStorage.getItem('mars.page') || 1;
    return p >= 1 && p <= PAGES.length ? p : 1;
  });
  const [cycle, setCycle] = useState(CONFIG.cycle);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // The status and clock tubes are part of the housing, not panels.
  const housing = useMemo(() => ({ status: HOUSING.status(station), clock: HOUSING.clock(station) }), []);

  useEffect(() => localStorage.setItem('mars.page', page), [page]);
  useEffect(() => {
    if (!cycle) return undefined;
    const id = setInterval(() => setPage((p) => (p % PAGES.length) + 1), cycle * 1000);
    return () => clearInterval(id);
  }, [cycle]);

  useEffect(() => {
    let e = null;
    try {
      e = createEngine(canvasRef.current, { fps: CONFIG.fps, dpr: CONFIG.dpr });
      setEngine(e);
      // debug hook: live screens and GPU objects, read by the smoke test's page-switch check
      window.__MARS__ = { stats: e.stats };
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
        if (source.kind !== 'SIMULATED') return;
        source.triggerIncident();
        store.note(1, 'TEST ALARM INJECTED BY OPERATOR');
      },
      speed() {
        const next = SPEEDS[(SPEEDS.indexOf(source.speed) + 1) % SPEEDS.length];
        source.setSpeed(next);
        store.note(0, `TIME BASE X${next}`);
        store.refresh();
      },
      finish: () => setFinish((f) => (f === 'ivory' ? 'graphite' : 'ivory')),
      page: (n) => setPage(n),
      next: () => setPage((p) => (p % PAGES.length) + 1),
      prev: () => setPage((p) => ((p + PAGES.length - 2) % PAGES.length) + 1),
      auto: () => setCycle((c) => (c ? 0 : CONFIG.cycle || DEFAULT_CYCLE)),
    }),
    [],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const fn = {
        f: actions.fullscreen,
        t: actions.test,
        s: actions.speed,
        b: actions.finish,
        a: actions.auto,
        arrowright: actions.next,
        arrowleft: actions.prev,
      }[e.key.toLowerCase()] ?? (/^[1-9]$/.test(e.key) && +e.key <= PAGES.length ? () => actions.page(+e.key) : null);
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
              <span className="plate-val">{station.name}</span>
            </div>
            <div className="plate">
              <span className="cap">Page{cycle ? ` · auto ${cycle}s` : ''}</span>
              <span className="plate-val">
                {String(page).padStart(2, '0')} {PAGES[page - 1].name.toUpperCase()}
              </span>
            </div>
            <div className="hd-right">
              <div className="lampwrap">
                <i className={`lamp ${snap.state}`} />
                <span className="cap">Alarm</span>
              </div>
              <Module name="System" className="status-mod">
                <Screen inst={housing.status} />
              </Module>
              <Module name="Local time" className="clock-mod" meta={snap.speed !== 1 ? `×${snap.speed}` : null}>
                <Screen inst={housing.clock} />
              </Module>
            </div>
          </header>

          <PageView key={PAGES[page - 1].id} page={PAGES[page - 1]} stations={STATIONS} first={FIRST[page - 1]} />

          <footer className="ft">
            <div className="keys">
              {PAGES.map((p, i) => (
                <Key key={p.id} k={i + 1} onClick={() => actions.page(i + 1)} active={page === i + 1}>
                  {p.name}
                </Key>
              ))}
              <Key k="A" onClick={actions.auto} active={!!cycle}>Auto</Key>
              <span className="keysep" />
              <Key k="F" onClick={actions.fullscreen}>Fullscreen</Key>
              <Key k="T" onClick={actions.test} accent>Test alarm</Key>
              <Key k="S" onClick={actions.speed}>Time ×{snap.speed}</Key>
              <Key k="B" onClick={actions.finish}>Finish</Key>
            </div>
            <div className="grille" />
            <div className="serial">
              Source {snap.kind} · {source.hostCount} nodes · SN 0001
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
