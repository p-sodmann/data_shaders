import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { REGISTRY, resolveOptions, panelName, panelMeta } from '../instruments/registry.js';
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

export function PageView({ page, stations, first = 1 }) {
  return (
    <main className="deck">
      {page.panels.map((panel, i) => (
        <Panel key={panel.id} panel={panel} station={stations[panel.station]} num={String(first + i).padStart(2, '0')} />
      ))}
    </main>
  );
}

const place = ({ x, y, w, h }) => ({ '--gc': `${x + 1} / span ${w}`, '--gr': `${y + 1} / span ${h}`, '--h': h });

function Panel({ panel, station, num }) {
  const def = REGISTRY[panel.type];
  const style = place(panel);
  if (!def) {
    return <EmptyPanel num={num} name={panel.type} style={style} text="NO MODULE" warning={`panel "${panel.id}": unknown type "${panel.type}"`} />;
  }
  if (def.scope === 'station' && !station) {
    return (
      <EmptyPanel
        num={num}
        name={safeName(def, panel.options) ?? panel.type}
        style={style}
        text="NO SIGNAL"
        warning={`panel "${panel.id}": no station "${panel.station}"`}
      />
    );
  }
  return <LivePanel panel={panel} def={def} station={station} num={num} style={style} />;
}

function safeName(def, options) {
  try {
    return panelName(def, resolveOptions(def, options));
  } catch {
    return null;
  }
}

function LivePanel({ panel, def, station, num, style }) {
  // Live captions and overlays follow the station's (throttled) snapshot.
  const snap = useSyncExternalStore(station.store.subscribe, station.store.getSnapshot);
  const optionsKey = JSON.stringify(panel.options ?? {});
  const built = useMemo(() => {
    const options = resolveOptions(def, panel.options);
    try {
      return { options, name: panelName(def, options), inst: def.create(station, options) };
    } catch (error) {
      return { options, error };
    }
    // keyed on the options' JSON, not the object, so an equal document doesn't rebuild the instrument
  }, [panel.id, panel.type, station, optionsKey]);

  if (built.error) {
    return <EmptyPanel num={num} name={panel.type} style={style} text="NO MODULE" warning={`panel "${panel.id}": ${built.error.message}`} />;
  }
  const { options, name, inst } = built;
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
