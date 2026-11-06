import { SHORT, axisX } from '../data/signal.js';

// 19 WATERFALL: a spectrogram of P50 latency. Each row is the spectrum of the
// 30 minutes before it, one row per 30 s, four hours deep. The top row is
// live: it is recomputed every 5 s and committed at the next boundary. A steady rhythm draws a vertical line; a scheduled job that starts or
// stops makes a line appear or end; an incident or a burst of spikes is a
// bright horizontal smear across all periods.

// plot rectangle in uv (y up), shared with the labels printed on the glass
export const WF = { L: 0.075, R: 0.985, B: 0.12, T: 0.965 };
export const WF_TICKS = [600, 300, 120, 60, 30, 16];
const xs = WF_TICKS.map((p) => axisX(SHORT, p).toFixed(4));

const FRAG = `
uniform sampler2D uFall;
uniform float uShift;
const vec4 RECT = vec4(${WF.L}, ${WF.B}, ${WF.R}, ${WF.T});
const float ROWS = ${SHORT.rows}.;
const float PER_HOUR = ${3600 / SHORT.every}.;
const float XT[${xs.length}] = float[](${xs.join(', ')});

void main(){
  vec2 q = (vUv - RECT.xy) / (RECT.zw - RECT.xy);
  vec2 px = vUv*uRes;
  vec3 col = vec3(0.);
  float line = 1.5*uDpr/uRes.x;
  if(q.x>=0. && q.x<=1. && q.y>=0. && q.y<=1.){
    // top band: the live row; below it the committed rows scroll down smoothly
    float r = (1.-q.y)*ROWS;
    float idx = r < 1. ? 0. : max(1., r - uShift);
    {
      float v = texture(uFall, vec2(q.x, (idx+.5)/ROWS)).r;
      col = PH_OK*(.04 + pow(v, 1.15)*1.5) + vec3(.85,1.,.9)*smoothstep(.75, 1., v)*.45;
      // write head, breathing while the live row is rewritten
      col += PH_OK*(.25+.15*sin(uTime*3.))*exp(-r*1.2);
    }
    // graticule: period ticks and hour lines
    for(int i=0;i<${xs.length};i++){
      float d = abs(q.x - XT[i])*(RECT.z-RECT.x)*uRes.x;
      col += PH_OK*.06*smoothstep(1.2*uDpr, 0., d)*step(.5, fract(px.y/(4.*uDpr)));
    }
    float hr = ((1.-q.y)*ROWS - uShift)/PER_HOUR;
    float dh = abs(fract(hr+.5)-.5)*PER_HOUR/ROWS*(RECT.w-RECT.y)*uRes.y;
    col += PH_OK*.06*smoothstep(1.2*uDpr, 0., dh)*step(.5, fract(px.x/(4.*uDpr)));
  }
  // frame
  vec2 c = (RECT.xy+RECT.zw)*.5, h = (RECT.zw-RECT.xy)*.5;
  float fd = abs(sdRoundBox((vUv-c)*uRes, h*uRes, 0.));
  col += PH_OK*.18*smoothstep(1.3*uDpr, 0., fd);
  fragColor = vec4(col, 1.);
}
`;

export function createWaterfall(station, options = {}) {
  const { store, signal } = station;
  let tex = null, uploaded = -1;
  return {
    frag: FRAG,
    crt: { curve: 0.025, scan: 0.85, bloom: 0.9, decay: 0.85 },
    init(gl, engine) {
      uploaded = -1;
      tex = engine.dataTexture({ internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR });
    },
    update(gl, _state, f) {
      signal.update(f.now);
      const { fall } = signal;
      if (fall.version !== uploaded) {
        tex.upload(SHORT.bins, SHORT.rows, fall.rows);
        uploaded = fall.version;
      }
      const now = store.now();
      const shift = fall.lastRow < 0 ? 0 : Math.max(0, Math.min(1, (now - fall.lastRow) / SHORT.every));
      return { uFall: tex.tex, uShift: shift };
    },
    dispose() {
      tex?.dispose();
    },
  };
}
