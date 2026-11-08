import { recoveryFrame } from '../data/recovery.js';
import { ROWS, ROW_SECONDS } from '../config.js';

// 01 TAPE ARCHIVE
// The front row is the current 10-minute window, written left to right by the
// beam. When it is full, the whole tape steps back one row and a fresh one
// slides in. Older rows recede in perspective as a ridgeline, so every row
// shares the same time-of-window axis: periodic behaviour forms vertical seams,
// incidents leave ridges that stay visible for four hours.
// Error rate is encoded as static under the ridge.

export const TAPE = { P: 0.06, YH: 1.3, Y0: 0.14, XL: 0.085, XR: 0.975, HS: 0.3 };
export const ROLL_MS = 1600;
// `max` is the station's full scale (profile.thresh.max)
export const tapeHeight = (ms, max) => Math.pow(Math.min(Math.max(ms / max, 0), 1.2), 0.85) * TAPE.HS;
export function rowGeom(z) {
  const s = 1 / (1 + z * TAPE.P);
  const base = TAPE.YH - (TAPE.YH - TAPE.Y0) * s;
  const cx = (TAPE.XL + TAPE.XR) / 2;
  const half = ((TAPE.XR - TAPE.XL) / 2) * s;
  return { s, base, left: cx - half, right: cx + half };
}
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const FRAG = `
uniform sampler2D uRows;
uniform vec4 uRecovery; // from, to and moving write head, relative to rowStart; glow
uniform float uHead, uLast, uShift, uWarn, uCrit, uMax, uLimits;
#define K ${ROWS}
const float N = ${ROW_SECONDS}.;
const float P = ${TAPE.P}, YH = ${TAPE.YH}, Y0 = ${TAPE.Y0}, XL = ${TAPE.XL}, XR = ${TAPE.XR}, HS = ${TAPE.HS};

float H(float ms){ return pow(clamp(ms/uMax, 0., 1.2), .85)*HS; }
vec2 rowAt(float u, float k){
  return texture(uRows, vec2((clamp(u,0.,1.)*N+.5)/N, (k+.5)/float(K))).rg;
}
vec3 sev(float ms){
  vec3 c = mix(PH_OK, PH_WARN, smoothstep(uWarn-1.5, uWarn+1.5, ms));
  return mix(c, PH_CRIT, smoothstep(uCrit-1.5, uCrit+1.5, ms));
}

void main(){
  vec2 uv = vUv;
  vec2 px = uv*uRes;
  vec3 col = PH_OK*0.012*smoothstep(.15, 1., uv.y);   // faint haze toward the back
  float zoff = uShift-1.;
  float cx = (XL+XR)*.5;

  for(int i=0;i<K;i++){
    float k = float(i);
    float z = k+zoff;
    float s = 1./(1.+z*P);
    float base = YH-(YH-Y0)*s;
    float halfW = (XR-XL)*.5*s;
    float u = (uv.x-cx)/(2.*halfW)+.5;
    if(u<0. || u>1.) continue;

    bool live = i==0;
    float fade = live ? 1. : pow(clamp(1.-z/float(K), 0., 1.), 1.5);
    float uu = live ? min(u, uLast) : u;
    vec2 d = rowAt(uu, k);
    float sampleT = -k*N+floor(uu*N);
    bool recovering = uRecovery.w > 0. && sampleT >= uRecovery.x && sampleT <= uRecovery.y;
    bool has = d.r >= 0. && !(live && u > uHead) && !(recovering && sampleT > uRecovery.z);
    float h = has ? H(d.r)*s : 0.;
    float ridge = base+h;

    // distance to the ridge line, corrected for slope
    float du = 2./(2.*halfW*uRes.x);
    float u2 = live ? min(u+du, uLast) : u+du;
    vec2 d2 = rowAt(u2, k);
    float h2 = (has && d2.r >= 0.) ? H(d2.r)*s : h;
    float slope = (h2-h)*uRes.y/2.;
    float dist = abs(uv.y-ridge)*uRes.y/sqrt(1.+slope*slope);
    float sigma = mix(1.05, .7, clamp(z/float(K), 0., 1.))*uDpr;
    float I = exp(-dist*dist/(2.*sigma*sigma));

    vec3 c = has ? sev(d.r) : PH_OK;
    float amp = has ? .95 : .2*step(.5, fract(u*N/4.));   // dotted where no data yet
    if(live && has){
      float age = (uHead-u)*N;
      amp *= 1.+1.8*exp(-age/5.);                        // fresh ink burns brighter
    }
    // Recovered ink is rewritten by a bright phosphor head, oldest to newest.
    float beamWidth = max(1.5, (uRecovery.y-uRecovery.x)/160.);
    float beam = recovering ? exp(-pow((sampleT-uRecovery.z)/beamWidth, 2.))*uRecovery.w : 0.;
    col += c*I*(amp+beam*3.)*fade;
    col += PH_OK*beam*.09*fade*exp(-abs(uv.y-ridge)*uRes.y/(24.*uDpr));

    // perspective dot grid at one-minute marks
    float um = floor(u*10.+.5)/10.;
    vec2 dd = vec2((u-um)*2.*halfW*uRes.x, (uv.y-base)*uRes.y);
    col += PH_OK*.32*fade*smoothstep(1.4*uDpr, .3*uDpr, length(dd));

    if(uv.y < ridge){
      // below this ridge: it occludes everything behind it
      float under = (ridge-uv.y)*uRes.y;
      if(has){
        col += c*.05*fade*exp(-under/(14.*uDpr));
        float e = clamp((d.g-.004)/.026, 0., 1.);
        float n = hash12(floor(px/(1.5*uDpr)) + floor(uTime*24.)*vec2(7.1,3.3));
        col += c*.5*fade*step(1.-e*.14, n)*exp(-under/(18.*uDpr));
      }
      break;
    }
  }

  // front row furniture
  float s0 = 1./(1.+zoff*P);
  float base0 = YH-(YH-Y0)*s0;
  float halfW0 = (XR-XL)*.5*s0;
  float u0 = (uv.x-cx)/(2.*halfW0)+.5;
  if(u0>=0. && u0<=1.){
    if(uv.y < base0){
      float mi = floor(u0*10.+.5);
      float dx = abs(u0-mi/10.)*2.*halfW0*uRes.x;
      float len = (mod(mi,5.)<.5 ? 14. : 7.)*uDpr;
      float below = (base0-uv.y)*uRes.y;
      col += PH_OK*.5*smoothstep(1.2*uDpr, .2*uDpr, dx)*step(below, len)*step(3.*uDpr, below);
    }
    float yw = base0+H(uWarn)*s0;
    col += uLimits*PH_WARN*.22*smoothstep(1.*uDpr, 0., abs(uv.y-yw)*uRes.y)*step(.5, fract(px.x/(9.*uDpr)));
    float yc = base0+H(uCrit)*s0;
    col += uLimits*PH_CRIT*.16*smoothstep(1.*uDpr, 0., abs(uv.y-yc)*uRes.y)*step(.75, fract(px.x/(9.*uDpr)));
  }

  // write head
  vec2 hd = rowAt(min(uHead, uLast), 0.);
  float hx = cx+(uHead-.5)*2.*halfW0;
  float hy = base0+(hd.r>=0. ? H(hd.r)*s0 : 0.);
  float dxh = abs(uv.x-hx)*uRes.x;
  col += PH_OK*.07*smoothstep(1.*uDpr, 0., dxh)*step(base0-.02, uv.y);
  float dh = length((uv-vec2(hx,hy))*uRes);
  col += sev(max(hd.r,0.))*1.7*exp(-dh*dh/(5.*uDpr*uDpr));

  fragColor = vec4(col, 1.);
}
`;

// options.limits: draw the warn and crit lines (default on)
export function createTape(station, options = {}) {
  const { store } = station;
  const { thresh } = station.profile;
  const limits = options.limits === false ? 0 : 1;
  let tex = null;
  let seen = -1;
  const data = new Float32Array(ROW_SECONDS * ROWS * 2);
  return {
    frag: FRAG,
    crt: { curve: 0.022, scan: 0.9, bloom: 1.0, decay: 0.9 },
    init(gl, engine) {
      tex = engine.dataTexture({ internal: gl.RG16F, format: gl.RG, type: gl.FLOAT, filter: gl.LINEAR });
      seen = -1;
    },
    update(gl, _state, f) {
      if (store.rowsVersion !== seen) {
        for (let k = 0; k < ROWS; k++) data.set(store.rows[k], k * ROW_SECONDS * 2);
        tex.upload(ROW_SECONDS, ROWS, data);
        seen = store.rowsVersion;
      }
      const head = store.rowStart === null ? 0 : clamp((store.now() - store.rowStart) / ROW_SECONDS, 0, 1);
      const p = clamp((f.now - store.rolloverWall) / ROLL_MS, 0, 1);
      const recovery = recoveryFrame(store.recovery, f.now);
      return {
        uRecovery: recovery ? [recovery.from - store.rowStart, recovery.to - store.rowStart, recovery.cursor - store.rowStart, recovery.glow] : [0, 0, 0, 0],
        uRows: tex.tex,
        uHead: head,
        uLast: Math.max(0, store.lastIdx) / ROW_SECONDS,
        uShift: easeOut(p),
        uWarn: thresh.warn,
        uCrit: thresh.crit,
        uMax: thresh.max,
        uLimits: limits,
      };
    },
    dispose() {
      tex?.dispose();
    },
  };
}
