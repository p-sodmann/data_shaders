import { DIGITS } from '../gl/shaders.js';

// 02 LOAD: a moving-coil meter. The needle is a damped spring, so it swings
// and settles like a physical instrument; phosphor persistence leaves a trail.

const FRAG = `
uniform float uVal, uPeak, uWarnV, uCritV;
${DIGITS}
vec3 sevV(float v){ return v>uCritV ? PH_CRIT : (v>uWarnV ? PH_WARN : PH_OK); }

void main(){
  float asp = uRes.x/uRes.y;
  vec2 p = vec2((vUv.x-.5)*asp, vUv.y);
  const float A = .78;
  float R = min(.92, (.5*asp-.17)/sin(A));
  vec2 piv = vec2(0., .76-R);
  vec2 q = p-piv;
  float r = length(q);
  float a = atan(q.x, q.y);
  float pxu = uRes.y;
  float v = (a+A)/(2.*A);
  vec3 col = vec3(0.);

  if(v>=0. && v<=1.){
    col += PH_OK*.35*smoothstep(1.2*uDpr, 0., abs(r-R)*pxu);
    float band = smoothstep(R-.036, R-.032, r)*smoothstep(R-.01, R-.014, r);
    vec3 zc = v>uCritV ? PH_CRIT : PH_WARN;
    col += zc*.5*band*step(uWarnV, v);
  }

  float mi = floor(v*50.+.5);
  if(mi>=0. && mi<=50.){
    bool maj = mod(mi,5.)<.5;
    float at = mi/50.*2.*A-A;
    float dpx = abs(a-at)*r*pxu;
    float len = maj ? .075 : .035;
    float on = step(R, r)*step(r, R+len);
    col += PH_OK*(maj ? .85 : .45)*on*smoothstep((maj?1.5:1.)*uDpr, .2*uDpr, dpx);
  }

  for(int i=0;i<=5;i++){
    float at = float(i)*.2*2.*A-A;
    vec2 c = piv+vec2(sin(at),cos(at))*(R+.14);
    col += PH_OK*.7*numberDots(p, c, .0125, i*20);
  }

  // peak hold tick
  float pa = uPeak*2.*A-A;
  float dp = abs(a-pa)*r*pxu;
  col += sevV(uPeak)*.8*step(R-.07, r)*step(r, R-.045)*smoothstep(2.*uDpr, .5*uDpr, dp);

  // needle
  float na = uVal*2.*A-A;
  vec2 dir = vec2(sin(na), cos(na));
  float dn = sdSegment(p, piv+dir*R*.6, piv+dir*(R+.06))*pxu;
  vec3 nc = sevV(uVal);
  col += nc*(1.2*exp(-dn*dn/(1.8*uDpr*uDpr)) + .1*exp(-dn/(10.*uDpr)));

  // readout
  col += nc*.95*numberDots(p, vec2(0., .14), .026, int(floor(uVal*100.+.5)));

  fragColor = vec4(col, 1.);
}
`;

export function createMeter(station, options = {}) {
  const { store } = station;
  const { thresh } = station.profile;
  let x = 0, v = 0, peak = 0, hold = 0;
  return {
    frag: FRAG,
    crt: { curve: 0.03, scan: 0.8, bloom: 0.95, decay: 0.84 },
    update(gl, _state, f) {
      const target = store.latest?.saturation ?? 0;
      const dt = Math.min(f.dt, 0.05);
      v += (38 * (target - x) - 7 * v) * dt; // under-damped: a little overshoot
      x += v * dt;
      const shown = Math.max(0, Math.min(1, x));
      if (shown >= peak) {
        peak = shown;
        hold = 3;
      } else if (hold > 0) hold -= dt;
      else peak = Math.max(shown, peak - dt * 0.05);
      return { uVal: shown, uPeak: peak, uWarnV: thresh.satWarn, uCritV: thresh.satCrit };
    },
  };
}
