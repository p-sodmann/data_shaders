// 23 WEEK DIAL: seven days of P50 latency on a 24-hour clock face. Midnight
// is at the top and the day runs clockwise. Each ring is one day: today is
// the outer ring, being written by the hand, and the oldest day is next to
// the hub. Brightness is latency on a log scale; amber and orange mark
// minutes that were degraded or in an incident. Daily habits line up as
// spokes across the rings; a day that went differently stands out as a ring.

export const DIAL = { outer: 0.44, hub: 0.3, days: 7, bins: 288 }; // radii as a fraction of min(w, h)
const LAT_LO = 5, LAT_HI = 80;

const FRAG = `
uniform sampler2D uDays;
uniform float uNow; // fraction of today elapsed
const float DAYS = ${DIAL.days}.;
const float TAU = 6.2831853;

void main(){
  vec2 px = vUv*uRes;
  vec2 p = px - uRes*.5;
  float S = min(uRes.x, uRes.y);
  float R0 = ${DIAL.outer}*S, Ri = ${DIAL.hub}*R0;
  float r = length(p);
  float a = fract(atan(p.x, p.y)/TAU);     // 0 at the top, clockwise
  float dr = (R0-Ri)/DAYS;
  float aa = 1.2*uDpr;                     // antialias width
  vec3 col = vec3(0.);

  // rings
  if(r > Ri && r < R0){
    float k = floor((R0-r)/dr);            // 0 = today
    float fr = fract((R0-r)/dr);
    float band = smoothstep(.08, .08+aa/dr, fr)*smoothstep(.92, .92-aa/dr, fr);
    vec4 d = texture(uDays, vec2(a, (k+.5)/DAYS));
    float valid = step(.5, d.b);
    float v = d.r;
    float st = d.g*2.;
    vec3 ph = st > 1.5 ? PH_CRIT : st > .5 ? PH_WARN : PH_OK;
    float glow = .05 + pow(v, 1.4)*1.15 + (st > .5 ? .25 : 0.);
    col += ph*glow*band*valid;
    col += PH_OK*.025*band*(1.-valid);     // unwritten paper
  }

  // hour ticks around the rim
  float ha = a*24.;
  float dh = abs(fract(ha+.5)-.5)/24.*TAU*r;
  bool major = abs(mod(floor(ha+.5), 6.)) < .5;
  float tick = smoothstep(aa, 0., dh)*step(R0+3.*uDpr, r)*step(r, R0+(major ? 12. : 6.)*uDpr);
  col += PH_OK*tick*(major ? .6 : .3);
  // faint spokes every 6 h across the rings
  col += PH_OK*.05*smoothstep(aa, 0., dh)*float(major)*step(Ri, r)*step(r, R0);
  // rims
  col += PH_OK*.18*smoothstep(aa, 0., abs(r-R0-1.5*uDpr));
  col += PH_OK*.14*smoothstep(aa, 0., abs(r-Ri+1.5*uDpr));

  // the hand
  float ang = uNow*TAU;
  vec2 dir = vec2(sin(ang), cos(ang));
  float along = dot(p, dir);
  float off = abs(dot(p, vec2(-dir.y, dir.x)));
  float hand = smoothstep(1.4*uDpr, 0., off)*step(Ri*.9, along)*step(along, R0+14.*uDpr);
  col += mix(PH_OK, vec3(1.), .4)*hand*(.75+.15*sin(uTime*2.));
  float tip = smoothstep(3.*uDpr, 0., length(p - dir*(R0+14.*uDpr)));
  col += PH_OK*tip;

  fragColor = vec4(col, 1.);
}
`;

export function createWeekDial(store, almanac) {
  let tex = null, buf = null, key = '';
  return {
    frag: FRAG,
    crt: { curve: 0.04, scan: 0.75, bloom: 1.0, decay: 0.85 },
    init(gl, engine) {
      key = '';
      tex = engine.dataTexture({ internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST });
      buf = new Uint8Array(DIAL.bins * DIAL.days * 4);
    },
    update() {
      const now = store.now();
      const d0 = new Date(now * 1000);
      d0.setHours(0, 0, 0, 0);
      const midnight = Math.floor(d0.getTime() / 60000); // minute index of local midnight today
      const step = 1440 / DIAL.bins;
      const k = `${almanac.version}:${midnight}`;
      if (k !== key) {
        key = k;
        const lo = Math.log(LAT_LO), span = Math.log(LAT_HI) - lo;
        for (let day = 0; day < DIAL.days; day++) {
          // local days are not always 1440 minutes long (DST); use the calendar
          const dd = new Date(d0);
          dd.setDate(dd.getDate() - day);
          const b = almanac.bins(Math.floor(dd.getTime() / 60000), DIAL.bins, step);
          for (let i = 0; i < DIAL.bins; i++) {
            const o = (day * DIAL.bins + i) * 4;
            const l = b.lat[i];
            const ok = l === l;
            buf[o] = ok ? Math.round(Math.max(0, Math.min(1, (Math.log(l) - lo) / span)) * 255) : 0;
            buf[o + 1] = ok ? Math.round((b.st[i] / 2) * 255) : 0;
            buf[o + 2] = ok ? 255 : 0;
            buf[o + 3] = 255;
          }
        }
        tex.upload(DIAL.bins, DIAL.days, buf);
      }
      return { uDays: tex.tex, uNow: (now / 60 - midnight) / 1440 };
    },
    dispose() {
      tex?.dispose();
    },
  };
}
