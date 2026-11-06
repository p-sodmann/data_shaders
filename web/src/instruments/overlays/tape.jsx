import React from 'react';
import { ROWS, ROW_SECONDS } from '../../config.js';
import { hm } from '../../data/telemetry.js';
import { rowGeom, tapeHeight, TAPE } from '../tape.js';

// Labels printed on the tape glass. They share the shader's geometry, and
// slide with the tape when a row is archived.
export function TapeOverlay({ station, snap }) {
  const { rowStart } = snap;
  const { thresh } = station.profile;
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
  const wy = (TAPE.Y0 + tapeHeight(thresh.warn, thresh.max)) * 100;
  const cy = (TAPE.Y0 + tapeHeight(thresh.crit, thresh.max)) * 100;
  return (
    <>
      {rows}
      {axis}
      <span className="ov thr warn" style={{ bottom: `${wy}%`, right: `${(1 - TAPE.XR) * 100}%` }}>
        WARN {thresh.warn}
      </span>
      <span className="ov thr crit" style={{ bottom: `${cy}%`, right: `${(1 - TAPE.XR) * 100}%` }}>
        CRIT {thresh.crit}
      </span>
      <span className="ov corner">P50 MS · −4 H ↑ · NOW ↓</span>
    </>
  );
}
