import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CONFIG, ROWS, ROW_SECONDS, THRESH, SLO } from './config.js';
import { store, source, almanac } from './runtime.js';
import { createEngine } from './gl/engine.js';
import { hm } from './data/telemetry.js';
import { createTape, rowGeom, tapeHeight, TAPE } from './instruments/tape.js';
import { createMeter } from './instruments/meter.js';
import { createMatrix } from './instruments/matrix.js';
import { createReadout, createLog, createClock, createStatus, createRules, createTrace, createContacts, createOrigins, createRhythms, createLogbook } from './instruments/panels.js';
import { createOrbit } from './instruments/orbit.js';
import { createFleet } from './instruments/fleet.js';
import { createSlices } from './instruments/slices.js';
import { createPipeline } from './instruments/pipeline.js';
import { createRadar } from './instruments/radar.js';
import { createGroundTrack } from './instruments/groundtrack.js';
import { createSignal } from './data/signal.js';
import { createSpectrum } from './instruments/spectrum.js';
import { createWaterfall, WF, WF_TICKS } from './instruments/waterfall.js';
import { createXYScope } from './instruments/xyscope.js';
import { createCorrelator } from './instruments/correlator.js';
import { SHORT, axisX } from './data/signal.js';
import { createWeekDial, DIAL } from './instruments/weekdial.js';
import { createHeatmap, HEAT, WEEKDAYS as HEAT_DAYS } from './instruments/heatmap.js';
import { createBudget, createBurnRate } from './instruments/budget.js';

const EngineContext = createContext(null);
const SPEEDS = [1, 10, 60];
const PAGES = [
  { id: 1, name: 'Tape' },
  { id: 2, name: 'Orbit' },
  { id: 3, name: 'Sweep' },
  { id: 4, name: 'Signal' },
  { id: 5, name: 'Almanac' },
];
const DEFAULT_CYCLE = 90;

function Screen({ inst, children }) {
  const engine = useContext(EngineContext);
  const ref = useRef(null);
  useEffect(() => (engine ? engine.add(ref.current, inst) : undefined), [engine, inst]);
  return (
    <div className="bezel">
      <div className="glass" ref={ref}>
        {children}
      </div>
    </div>
  );
}

function Module({ num, name, meta, className = '', children }) {
  return (
    <section className={`mod ${className}`}>
      <header className="mod-head">
        {num && <span className="num">{num}</span>}
        <span className="name">{name}</span>
        {meta && <span className="meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

// Labels printed on the tape glass. They share the shader's geometry, and
// slide with the tape when a row is archived.
function TapeOverlay({ rowStart }) {
  if (rowStart == null) return null;
  const rows = [];
  for (let k = 0; k < ROWS; k++) {
    const t = rowStart - k * ROW_SECONDS;
    const m = new Date(t * 1000).getMinutes();
    if (k !== 0 && m !== 0 && m !== 30) continue;
    const g = rowGeom(k);
    rows.push(
      <span
        key={t}
        className={`ov tl${k === 0 ? ' now' : ''}`}
        style={{ bottom: `${g.base * 100}%`, right: `${(1 - g.left) * 100 + 0.8}%`, opacity: k === 0 ? 1 : 1 - (k / ROWS) * 0.75 }}
      >
        {hm(t)}
      </span>,
    );
  }
  const axis = [0, 2, 4, 6, 8, 10].map((m) => (
    <span key={m} className="ov ax" style={{ left: `${(TAPE.XL + ((TAPE.XR - TAPE.XL) * m) / 10) * 100}%` }}>
      {m === 10 ? '10 MIN' : `+${m}`}
    </span>
  ));
  const wy = (TAPE.Y0 + tapeHeight(THRESH.warn)) * 100;
  const cy = (TAPE.Y0 + tapeHeight(THRESH.crit)) * 100;
  return (
    <>
      {rows}
      {axis}
      <span className="ov thr warn" style={{ bottom: `${wy}%`, right: `${(1 - TAPE.XR) * 100}%` }}>
        WARN {THRESH.warn}
      </span>
      <span className="ov thr crit" style={{ bottom: `${cy}%`, right: `${(1 - TAPE.XR) * 100}%` }}>
        CRIT {THRESH.crit}
      </span>
      <span className="ov corner">P50 MS · −4 H ↑ · NOW ↓</span>
    </>
  );
}

// Labels printed on the waterfall glass, in the shader's plot rectangle.
function WaterfallOverlay() {
  const x = (p) => `${(WF.L + axisX(SHORT, p) * (WF.R - WF.L)) * 100}%`;
  const fmt = (p) => (p >= 60 ? `${p / 60} MIN` : `${p} S`);
  const y = (h) => `${(WF.T - ((h * 3600) / SHORT.every / SHORT.rows) * (WF.T - WF.B)) * 100}%`;
  return (
    <>
      {WF_TICKS.map((p) => (
        <span key={p} className="ov ax" style={{ left: x(p), bottom: '3%' }}>
          {fmt(p)}
        </span>
      ))}
      {[0, 1, 2, 3, 4].map((h) => (
        <span key={h} className="ov wfh" style={{ bottom: y(h), right: `${(1 - WF.L) * 100 + 0.8}%` }}>
          {h ? `−${h} H` : 'NOW'}
        </span>
      ))}
    </>
  );
}

// Hour and weekday labels printed around the week dial. The dial is sized
// from the glass, so the labels measure it too.
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function DialOverlay() {
  const ref = useRef(null);
  const [size, setSize] = useState(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const out = [];
  if (size) {
    const [w, h] = size;
    const R0 = DIAL.outer * Math.min(w, h), Ri = DIAL.hub * R0, dr = (R0 - Ri) / DIAL.days;
    for (const hr of [0, 3, 6, 9, 12, 15, 18, 21]) {
      const a = (hr / 24) * 2 * Math.PI, rr = R0 + 26;
      out.push(
        <span key={`h${hr}`} className={`ov dial${hr % 6 ? ' minor' : ''}`} style={{ left: w / 2 + Math.sin(a) * rr, top: h / 2 - Math.cos(a) * rr }}>
          {String(hr).padStart(2, '0')}
        </span>,
      );
    }
    const today = new Date().getDay();
    for (let k = 0; k < DIAL.days; k++) {
      const r = R0 - (k + 0.5) * dr;
      out.push(
        <span key={`d${k}`} className={`ov dial day${k === 0 ? ' now' : ''}`} style={{ left: w / 2, top: h / 2 - r }}>
          {k === 0 ? 'TODAY' : WEEKDAYS[(today - k + 7) % 7]}
        </span>,
      );
    }
  }
  return <span ref={ref} className="ov-anchor">{out}</span>;
}

// Labels printed on the habits glass, in the shader's grid rectangle.
function HeatOverlay({ inst }) {
  const pct = (v) => `${v * 100}%`;
  const rowY = (r) => pct(1 - (HEAT.T - ((r + 0.5) / 7) * (HEAT.T - HEAT.B)));
  const colX = (c) => pct(HEAT.L + ((c + 0.5) / 24) * (HEAT.R - HEAT.L));
  const lg = inst.legend;
  return (
    <>
      {HEAT_DAYS.map((d, r) => (
        <span key={d} className="ov heat day" style={{ top: rowY(r), right: pct(1 - HEAT.L + 0.012) }}>
          {d}
        </span>
      ))}
      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
        <span key={h} className="ov heat hr" style={{ left: colX(h), top: pct(1 - HEAT.T - 0.045) }}>
          {String(h).padStart(2, '0')}
        </span>
      ))}
      <span className="ov heat cap" style={{ left: pct(HEAT.ML), top: pct(1 - HEAT.T - 0.045) }}>DAY</span>
      <span className="ov heat cap" style={{ right: pct(1 - HEAT.L + 0.012), top: pct(1 - (HEAT.MT + HEAT.MB) / 2) }}>
        HOUR
      </span>
      {lg && (
        <span className="ov heat cap" style={{ left: pct(HEAT.ML), top: pct(1 - (HEAT.MT + HEAT.MB) / 2) }}>
          {Math.round(lg.lo)}–{Math.round(lg.hi)} MS
        </span>
      )}
    </>
  );
}

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

  const inst = useMemo(() => {
    const signal = createSignal(store);
    return {
      tape: createTape(store),
      meter: createMeter(store),
      matrix: createMatrix(store),
      status: createStatus(store),
      clock: createClock(store),
      log: createLog(store),
      latency: createReadout(store, {
        value: (s) => s.disp?.lat,
        format: (v) => v.toFixed(1),
        max: THRESH.max,
        warn: THRESH.warn,
        crit: THRESH.crit,
        chars: 5,
      }),
      throughput: createReadout(store, {
        value: (s) => s.disp?.tp,
        format: (v) => String(Math.round(v)),
        max: THRESH.tpMax,
        chars: 5,
      }),
      errors: createReadout(store, {
        value: (s) => s.disp?.err,
        format: (v) => (v * 100).toFixed(2),
        max: THRESH.errMax,
        warn: THRESH.errWarn,
        crit: THRESH.errCrit,
        chars: 5,
      }),
      orbit: createOrbit(store),
      fleet: createFleet(store),
      slices: createSlices(store),
      pipeline: createPipeline(store),
      rules: createRules(store),
      trace: createTrace(store),
      radar: createRadar(store),
      ground: createGroundTrack(store),
      contacts: createContacts(store),
      origins: createOrigins(store),
      spectrum: createSpectrum(store, signal),
      waterfall: createWaterfall(store, signal),
      xy: createXYScope(store, signal),
      correlator: createCorrelator(store, signal),
      rhythms: createRhythms(store, signal),
      dial: createWeekDial(store, almanac),
      heatmap: createHeatmap(store, almanac),
      budget: createBudget(almanac),
      burn: createBurnRate(store, almanac),
      logbook: createLogbook(almanac),
    };
  }, []);

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
        1: () => actions.page(1),
        2: () => actions.page(2),
        3: () => actions.page(3),
        4: () => actions.page(4),
        5: () => actions.page(5),
        arrowright: actions.next,
        arrowleft: actions.prev,
      }[e.key.toLowerCase()];
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

  const c = snap.counts;
  const nodeMeta = [`${c.ok} OK`, c.warn && `${c.warn} WARN`, c.crit && `${c.crit} CRIT`, c.off && `${c.off} OFF`]
    .filter(Boolean)
    .join(' · ');

  const closing = store.endpoints.filter((ep) => ep.live && ep.state).length;
  const contactMeta = closing ? `${closing} inside 75 %` : 'All clear of limits';

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
              <span className="plate-val">{CONFIG.station}</span>
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
                <Screen inst={inst.status} />
              </Module>
              <Module name="Local time" className="clock-mod" meta={snap.speed !== 1 ? `×${snap.speed}` : null}>
                <Screen inst={inst.clock} />
              </Module>
            </div>
          </header>

          {page === 1 && (
            <>
              <main className="deck" key="p1-deck">
                <Module num="01" name="Tape archive" meta="P50 latency · 10 min per row · 4 h" className="m-tape">
                  <Screen inst={inst.tape}>
                    <TapeOverlay rowStart={snap.rowStart} />
                  </Screen>
                </Module>
                <div className="side">
                  <Module num="02" name="Load" meta="Cluster saturation %">
                    <Screen inst={inst.meter} />
                  </Module>
                  <Module num="03" name="Nodes" meta={nodeMeta}>
                    <Screen inst={inst.matrix} />
                  </Module>
                </div>
              </main>
              <section className="bank" key="p1-bank">
                <Module num="04" name="Latency" meta="P50 · ms">
                  <Screen inst={inst.latency} />
                </Module>
                <Module num="05" name="Throughput" meta="req / s">
                  <Screen inst={inst.throughput} />
                </Module>
                <Module num="06" name="Errors" meta="% of req">
                  <Screen inst={inst.errors} />
                </Module>
                <Module num="07" name="Event log" meta="Teletype" className="m-log">
                  <Screen inst={inst.log} />
                </Module>
              </section>
            </>
          )}
          {page === 2 && (
            <>
              <main className="deck p2" key="p2-deck">
                <Module num="08" name="Orbit" meta="Service topology · live calls" className="m-orbit">
                  <Screen inst={inst.orbit} />
                </Module>
                <div className="side">
                  <Module num="09" name="Fleet" meta="Per-node latency · 3 min">
                    <Screen inst={inst.fleet} />
                  </Module>
                  <Module num="11" name="Slices" meta="Fleet fingerprint · 10 min">
                    <Screen inst={inst.slices} />
                  </Module>
                </div>
              </main>
              <section className="bank p2" key="p2-bank">
                <Module num="10" name="Pipeline" meta="Request stages · ms">
                  <Screen inst={inst.pipeline} />
                </Module>
                <Module num="12" name="Caution & warning" meta="Rules">
                  <Screen inst={inst.rules} />
                </Module>
                <Module num="13" name="Trace" meta="Sampled requests">
                  <Screen inst={inst.trace} />
                </Module>
              </section>
            </>
          )}
          {page === 3 && (
            <>
              <main className="deck p3" key="p3-deck">
                <Module num="14" name="Proximity" meta="Endpoints · range = headroom to SLO">
                  <Screen inst={inst.radar} />
                </Module>
                <Module num="15" name="Ground track" meta="Traffic origins · centre of traffic, 4 h">
                  <Screen inst={inst.ground} />
                </Module>
              </main>
              <section className="bank p3" key="p3-bank">
                <Module num="16" name="Contacts" meta={contactMeta}>
                  <Screen inst={inst.contacts} />
                </Module>
                <Module num="17" name="Origins" meta="Client regions · RTT ms · err %">
                  <Screen inst={inst.origins} />
                </Module>
              </section>
            </>
          )}

          {page === 4 && (
            <>
              <main className="deck p4" key="p4-deck">
                <div className="stack">
                  <Module num="18" name="Spectrum" meta="P50 latency · 4 h reference · 10 min live">
                    <Screen inst={inst.spectrum} />
                  </Module>
                  <Module num="19" name="Waterfall" meta="Spectrogram · 30 min window · 1 row per 30 s">
                    <Screen inst={inst.waterfall}>
                      <WaterfallOverlay />
                    </Screen>
                  </Module>
                </div>
                <Module num="20" name="X‑Y scope" meta="Latency vs load · operating curve">
                  <Screen inst={inst.xy} />
                </Module>
              </main>
              <section className="bank p4" key="p4-bank">
                <Module num="21" name="Correlator" meta="Signal pairs · 10 min vs 4 h">
                  <Screen inst={inst.correlator} />
                </Module>
                <Module num="22" name="Rhythms" meta="Scheduled behaviour · epoch folding">
                  <Screen inst={inst.rhythms} />
                </Module>
              </section>
            </>
          )}

          {page === 5 && (
            <>
              <main className="deck p5" key="p5-deck">
                <Module num="23" name="Week dial" meta="P50 · 7 days on a 24 h clock">
                  <Screen inst={inst.dial}>
                    <DialOverlay />
                  </Screen>
                </Module>
                <Module num="24" name="Habits" meta="Typical P50 by weekday and hour · 30 d · ■ incident share">
                  <Screen inst={inst.heatmap}>
                    <HeatOverlay inst={inst.heatmap} />
                  </Screen>
                </Module>
              </main>
              <section className="bank p5" key="p5-bank">
                <Module num="25" name="Error budget" meta={`Availability SLO · rolling ${SLO.days} d`}>
                  <Screen inst={inst.budget} />
                </Module>
                <Module num="26" name="Burn rate" meta="× sustainable · 24 h · multi-window alerts">
                  <Screen inst={inst.burn} />
                </Module>
                <Module num="27" name="Logbook" meta="Incidents · 30 d">
                  <Screen inst={inst.logbook} />
                </Module>
              </section>
            </>
          )}

          <footer className="ft">
            <div className="keys">
              {PAGES.map((p) => (
                <Key key={p.id} k={p.id} onClick={() => actions.page(p.id)} active={page === p.id}>
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
              Source {snap.kind} · {CONFIG.hosts} nodes · SN 0001
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
