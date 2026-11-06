import { ALMANAC_DAYS } from '../config.js';

// 24 HABITS: the typical P50 latency for every weekday and hour, from the 30
// days in the almanac (the median of about four weeks per cell). Brightness
// runs from the quietest slot to the busiest, so the habits of the system
// show: busy afternoons, quiet weekends, the slot where the batch job lands.
// An orange mark grows with how often that slot was in an incident. The strip
// on the right is each weekday's average, the strip below each hour's. The
// framed cell is now.

export const HEAT = { L: 0.11, R: 0.885, T: 0.86, B: 0.22, ML: 0.905, MR: 0.975, MT: 0.17, MB: 0.06 };
export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const FRAG = `
uniform sampler2D uGrid;  // 25 x 8: cells, plus row means (x = 24) and column means (y = 7)
uniform vec2 uNow;        // current hour, weekday
const vec4 G = vec4(${HEAT.L}, ${HEAT.B}, ${HEAT.R}, ${HEAT.T});

float box(vec2 q, vec2 lo, vec2 hi, float aa){
  vec2 d = min(q-lo, hi-q);
  return smoothstep(0., aa, min(d.x, d.y));
}

void main(){
  vec2 px = vUv*uRes;
  vec3 col = vec3(0.);
  float aa = 1.2*uDpr;

  // cells
  vec2 q = (vUv - G.xy)/(G.zw - G.xy);
  if(q.x >= 0. && q.x < 1. && q.y >= 0. && q.y < 1.){
    vec2 cell = vec2(floor(q.x*24.), floor((1.-q.y)*7.));      // hour, weekday (0 = Monday, top)
    vec4 d = texture(uGrid, (cell + .5)/vec2(25., 8.));
    vec2 size = (G.zw - G.xy)*uRes/vec2(24., 7.);
    vec2 f = vec2(fract(q.x*24.), fract((1.-q.y)*7.))*size;
    float inside = box(f, vec2(1.5*uDpr), size - 1.5*uDpr, aa);
    if(d.b > .5){
      col += PH_OK*(.03 + pow(d.r, 2.)*.8)*inside;
      // incident mark: an orange square growing from the cell's corner
      float m = sqrt(d.g)*.55*min(size.x, size.y);
      if(d.g > .004) col += PH_CRIT*.85*box(f, size - 3.*uDpr - m, size - 3.*uDpr, aa);
    } else {
      col += PH_OK*.015*inside;
    }
    // now
    if(cell == uNow){
      float fr = box(f, vec2(0.), size, aa) - box(f, vec2(2.*uDpr), size - 2.*uDpr, aa);
      col += mix(PH_OK, vec3(1.), .4)*fr*(.8 + .2*sin(uTime*3.));
    }
  }

  // row means: horizontal bars on the right
  vec2 rq = vec2((vUv.x - ${HEAT.ML})/(${HEAT.MR - HEAT.ML}), (vUv.y - G.y)/(G.w - G.y));
  if(rq.x >= 0. && rq.x < 1. && rq.y >= 0. && rq.y < 1.){
    float row = floor((1.-rq.y)*7.);
    float v = texture(uGrid, vec2(24.5/25., (row+.5)/8.)).r;
    float fy = fract((1.-rq.y)*7.);
    float bar = step(rq.x, .08 + .92*v)*step(.25, fy)*step(fy, .75);
    col += PH_OK*.4*bar + PH_OK*.04*step(fy, .75)*step(.25, fy);
  }
  // column means: vertical bars below
  vec2 cq = vec2((vUv.x - G.x)/(G.z - G.x), (vUv.y - ${HEAT.MB})/(${HEAT.MT - HEAT.MB}));
  if(cq.x >= 0. && cq.x < 1. && cq.y >= 0. && cq.y < 1.){
    float c = floor(cq.x*24.);
    float v = texture(uGrid, vec2((c+.5)/25., 7.5/8.)).r;
    float fx = fract(cq.x*24.);
    float bar = step(cq.y, .08 + .92*v)*step(.25, fx)*step(fx, .75);
    col += PH_OK*.4*bar + PH_OK*.04*step(fx, .75)*step(.25, fx);
  }

  // frame
  vec2 c0 = (G.xy + G.zw)*.5, h0 = (G.zw - G.xy)*.5;
  col += PH_OK*.16*smoothstep(1.3*uDpr, 0., abs(sdRoundBox((vUv - c0)*uRes, h0*uRes, 0.)));
  fragColor = vec4(col, 1.);
}
`;

const median = (a) => {
  const s = a.filter((x) => x === x).sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : NaN;
};

export function createHeatmap(station, options = {}) {
  const { store, almanac } = station;
  let tex = null, key = '';
  const buf = new Uint8Array(25 * 8 * 4);
  const inst = {
    frag: FRAG,
    crt: { curve: 0.03, scan: 0.8, bloom: 0.95, decay: 0.85 },
    legend: null, // { lo, hi } in ms, read by the glass labels
    init(gl, engine) {
      key = '';
      tex = engine.dataTexture({ internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST });
    },
    update() {
      const now = store.now();
      const dn = new Date(now * 1000);
      const nowCell = [dn.getHours(), (dn.getDay() + 6) % 7];
      const k = `${almanac.version}`;
      if (k !== key) {
        key = k;
        // local hour boundaries over the window
        const start = new Date(dn);
        start.setMinutes(0, 0, 0);
        start.setHours(start.getHours() - ALMANAC_DAYS * 24 + 1);
        const n = ALMANAC_DAYS * 24;
        const hrs = almanac.hours(Math.floor(start.getTime() / 60000), n);
        const lats = Array.from({ length: 168 }, () => []);
        const incs = Array.from({ length: 168 }, () => []);
        const d = new Date(start);
        for (let i = 0; i < n; i++) {
          const slot = ((d.getDay() + 6) % 7) * 24 + d.getHours();
          if (hrs.lat[i] === hrs.lat[i]) {
            lats[slot].push(hrs.lat[i]);
            incs[slot].push(hrs.inc[i]);
          }
          d.setHours(d.getHours() + 1);
        }
        const med = lats.map(median);
        const inc = incs.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0));
        // scale from the 10th to the 90th percentile, so one odd slot does not flatten the rest
        const valid = med.filter((x) => x === x).sort((a, b) => a - b);
        const lo = valid[Math.floor(valid.length * 0.1)], hi = Math.max(valid[Math.floor(valid.length * 0.9)] ?? lo, lo + 2);
        const norm = (v) => (v === v ? Math.max(0, Math.min(1, (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)))) : 0);
        inst.legend = valid.length ? { lo, hi } : null;
        buf.fill(0);
        const put = (x, y, r, g, b) => {
          const o = (y * 25 + x) * 4;
          buf[o] = Math.round(r * 255);
          buf[o + 1] = Math.round(Math.min(1, g) * 255);
          buf[o + 2] = b ? 255 : 0;
          buf[o + 3] = 255;
        };
        for (let wd = 0; wd < 7; wd++) {
          for (let h = 0; h < 24; h++) put(h, wd, norm(med[wd * 24 + h]), inc[wd * 24 + h] * 4, med[wd * 24 + h] === med[wd * 24 + h]);
          const row = med.slice(wd * 24, wd * 24 + 24).filter((x) => x === x);
          put(24, wd, row.length ? norm(row.reduce((a, b) => a + b, 0) / row.length) : 0, 0, row.length);
        }
        for (let h = 0; h < 24; h++) {
          const col = [0, 1, 2, 3, 4, 5, 6].map((wd) => med[wd * 24 + h]).filter((x) => x === x);
          put(h, 7, col.length ? norm(col.reduce((a, b) => a + b, 0) / col.length) : 0, 0, col.length);
        }
        tex.upload(25, 8, buf);
      }
      return { uGrid: tex.tex, uNow: nowCell };
    },
    dispose() {
      tex?.dispose();
    },
  };
  return inst;
}
