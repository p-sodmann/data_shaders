import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { REGISTRY, resolveOptions, panelName, panelMeta } from '../instruments/registry.js';
import { createTapeLoad } from '../instruments/panels.js';
import { Module, Screen } from './device.jsx';

// Lays out one page's panels on the 12 × 8 deck grid. Each panel builds its own
// instrument from its station when it mounts; switching pages unmounts the
// panels, which drops the instruments and frees their GPU resources through
// the engine's disposer.

// Module numbers run on across pages in panel order, so a module keeps its
// number for a given document. Returns the first number of each page.
export function firstNumbers(pages) {
  let n = 1;
  return pages.map((p) => {
    const first = n;
    n += p.panels.length;
    return first;
  });
}

// stations: { id: station }. device: { stations } for panels bound to '*' and
// cross-station instruments. named: put the station's name in each module header
// (when the document has more than one station).
export function PageView({ page, stations, device, named = false, first = 1 }) {
  return (
    <main className="deck">
      {page.panels.map((panel, i) => (
        <Panel
          key={panel.id}
          panel={panel}
          stations={stations}
          device={device}
          named={named}
          num={moduleNumber(first, i)}
          style={place(panel)}
        />
      ))}
    </main>
  );
}

export const moduleNumber = (first, i) => String(first + i).padStart(2, '0');

const place = ({ x, y, w, h }) => ({ '--gc': `${x + 1} / span ${w}`, '--gr': `${y + 1} / span ${h}`, '--h': h });

// What a panel's instrument is built on: one station, or the whole device.
function targetOf(def, panel, stations, device) {
  if (def.scope === 'device') return device;
  if (panel.station === '*') return def.scope === 'either' ? device : null;
  return stations[panel.station] ?? null;
}

// One module: the panel's instrument on its station, or an empty bay. The
// service panel's editable deck mounts the same component (step 08); `style`
// is the grid placement here and empty there.
export function Panel({ panel, stations, device, named, num, style }) {
  const def = REGISTRY[panel.type];
  if (!def) {
    return <EmptyPanel num={num} name={panel.type} style={style} text="NO MODULE" warning={`panel "${panel.id}": unknown type "${panel.type}"`} />;
  }
  const station = targetOf(def, panel, stations, device);
  if (!station) {
    return (
      <EmptyPanel
        num={num}
        name={safeName(def, panel.options) ?? panel.type}
        style={style}
        text="NO SIGNAL"
        warning={panel.station === '*' ? `panel "${panel.id}": "${panel.type}" needs one station, not '*'` : `panel "${panel.id}": no station "${panel.station}"`}
      />
    );
  }
  return <StationPanel panel={panel} def={def} station={station} named={named} num={num} style={style} />;
}

const noStatus = { subscribe: () => () => {}, getStatus: () => null };

// A station that is still loading its tape (or rebuilding, ADR-0007) shows
// TAPE LOAD on every screen; its instruments are built once it is live, on the
// store it has then. The device (panels bound to '*') has no status.
function StationPanel(props) {
  const { station } = props;
  const src = station.getStatus ? station : noStatus;
  const status = useSyncExternalStore(src.subscribe, src.getStatus);
  if (status?.phase === 'load') return <LoadingPanel {...props} />;
  return <LivePanel {...props} generation={status?.generation ?? 0} />;
}

function LoadingPanel({ panel, def, station, named, num, style }) {
  const inst = useMemo(() => createTapeLoad(station), [station]);
  const base = safeName(def, panel.options) ?? panel.type;
  return (
    <Module num={num} name={named ? `${base} · ${station.name}` : base} meta="Tape load" className="panel" style={style}>
      <Screen inst={inst} />
    </Module>
  );
}

function safeName(def, options) {
  try {
    return panelName(def, resolveOptions(def, options));
  } catch {
    return null;
  }
}

const noStore = { subscribe: () => () => {}, getSnapshot: () => null };

function LivePanel({ panel, def, station, named, num, style, generation }) {
  // Live captions and overlays follow the station's (throttled) snapshot. The
  // device has no store of its own; its instruments draw from the stations.
  const store = station.store ?? noStore;
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const holdsSignal = def.needs.includes('signal') && !!station.retainSignal;
  useEffect(() => (holdsSignal ? station.retainSignal() : undefined), [holdsSignal, station]);
  const optionsKey = JSON.stringify(panel.options ?? {});
  const built = useMemo(() => {
    const options = resolveOptions(def, panel.options);
    try {
      return { options, name: panelName(def, options), inst: def.create(station, options) };
    } catch (error) {
      return { options, error };
    }
    // keyed on the options' JSON, not the object, so an equal document doesn't rebuild the instrument;
    // a rebuilt station (new generation) has new tables, so its instruments are built again
  }, [panel.id, panel.type, station, optionsKey, generation]);

  if (built.error) {
    return <EmptyPanel num={num} name={panel.type} style={style} text="NO MODULE" warning={`panel "${panel.id}": ${built.error.message}`} />;
  }
  const { options, inst } = built;
  const name = named && station.name ? `${built.name} · ${station.name}` : built.name;
  const Overlay = def.overlay;
  return (
    <Module num={num} name={name} meta={panelMeta(def, { station, snap, options })} className="panel" style={style}>
      <Screen inst={inst}>{Overlay && <Overlay inst={inst} station={station} snap={snap} options={options} />}</Screen>
    </Module>
  );
}

// An empty bay: the module frame with an engraved notice instead of a tube.
// Each problem is logged once per session, not on every page visit.
const warned = new Set();
function EmptyPanel({ num, name, style, text, warning }) {
  useEffect(() => {
    if (warned.has(warning)) return;
    warned.add(warning);
    console.warn(`[MARS] ${warning}`);
  }, [warning]);
  return (
    <Module num={num} name={name} className="panel" style={style}>
      <div className="bezel empty">
        <span className="engraved">{text}</span>
      </div>
    </Module>
  );
}
