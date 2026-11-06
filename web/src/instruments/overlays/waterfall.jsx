import React from 'react';
import { SHORT, axisX } from '../../data/signal.js';
import { WF, WF_TICKS } from '../waterfall.js';

// Labels printed on the waterfall glass, in the shader's plot rectangle.
export function WaterfallOverlay() {
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
