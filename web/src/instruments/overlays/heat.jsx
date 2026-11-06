import React from 'react';
import { HEAT, WEEKDAYS } from '../heatmap.js';

// Labels printed on the habits glass, in the shader's grid rectangle.
export function HeatOverlay({ inst }) {
  const pct = (v) => `${v * 100}%`;
  const rowY = (r) => pct(1 - (HEAT.T - ((r + 0.5) / 7) * (HEAT.T - HEAT.B)));
  const colX = (c) => pct(HEAT.L + ((c + 0.5) / 24) * (HEAT.R - HEAT.L));
  const lg = inst.legend;
  return (
    <>
      {WEEKDAYS.map((d, r) => (
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
