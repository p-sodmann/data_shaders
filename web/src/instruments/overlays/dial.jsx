import React, { useEffect, useRef, useState } from 'react';
import { DIAL } from '../weekdial.js';

// Hour and weekday labels printed around the week dial. The dial is sized
// from the glass, so the labels measure it too.
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export function DialOverlay() {
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
