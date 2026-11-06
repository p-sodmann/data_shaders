import React from 'react';
import { REGISTRY, panelName, resolveOptions } from '../../instruments/registry.js';
import { Key } from '../device.jsx';
import { OptionControl, Row, StationLamp } from './controls.jsx';

// The settings plate of the selected module: which station feeds it, the
// instrument's own options (from its registry schema), and remove, duplicate
// and swap. Every change goes straight into the document.

export function SettingsPlate({ panel, num, doc, stations, swapping, onChange, onRemove, onDuplicate, onSwap }) {
  const def = REGISTRY[panel.type];
  const options = def ? resolveOptions(def, panel.options) : panel.options;
  const scope = def?.scope ?? 'station';
  const setOption = (key, value) => onChange({ options: { ...panel.options, [key]: value } });

  return (
    <section className="settings">
      <header className="plate-head">
        <span className="num">{num}</span>
        <span className="name">{def ? panelName(def, options) : panel.type}</span>
        <span className="meta">
          {panel.w} × {panel.h} at {panel.x + 1}, {panel.y + 1}
        </span>
      </header>

      {scope !== 'device' && (
        <Row label="Station">
          <div className="stations">
            {doc.stations.map((s) => (
              <button
                key={s.id}
                className={`station-pick${panel.station === s.id ? ' on' : ''}`}
                data-station={s.id}
                tabIndex={-1}
                onClick={() => onChange({ station: s.id })}
              >
                <StationLamp station={stations[s.id]} />
                <span>{s.name}</span>
              </button>
            ))}
            {scope === 'either' && (
              <button className={`station-pick${panel.station === '*' ? ' on' : ''}`} data-station="*" tabIndex={-1} onClick={() => onChange({ station: '*' })}>
                <i className="lamp small all" />
                <span>All stations</span>
              </button>
            )}
          </div>
        </Row>
      )}

      {def &&
        Object.entries(def.options).map(([key, spec]) => (
          <Row key={key} label={spec.label ?? key}>
            <OptionControl spec={spec} value={options[key]} onChange={(v) => setOption(key, v)} />
          </Row>
        ))}

      <div className="plate-keys">
        <Key k="⌫" onClick={onRemove}>
          Remove
        </Key>
        <Key k="D" onClick={onDuplicate}>
          Duplicate
        </Key>
        <Key k="⇄" onClick={onSwap} active={swapping}>
          Swap
        </Key>
      </div>
    </section>
  );
}
