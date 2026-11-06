// 03 NODES: one lamp per host. Each lamp is also a level gauge (load fills it
// from the bottom), its colour is its state, warn breathes, crit blinks,
// offline goes dark with a strike-through. A refresh beam sweeps the bank.

const FRAG = `
uniform sampler2D uHosts;
uniform vec2 uGrid;
uniform float uScan;

void main(){
  vec2 px = vec2(vUv.x, 1.-vUv.y)*uRes;
  float pad = 9.*uDpr;
  vec2 cs = (uRes-2.*pad)/uGrid;
  vec2 g = (px-pad)/cs;
  vec2 cell = floor(g);
  vec3 col = vec3(0.);
  float scanX = pad+uScan*(uRes.x-2.*pad);

  if(cell.x>=0. && cell.y>=0. && cell.x<uGrid.x && cell.y<uGrid.y){
    vec4 h = texelFetch(uHosts, ivec2(cell), 0);
    if(h.a > .5){
      vec2 lp = (fract(g)-.5)*cs;
      float gap = max(3.*uDpr, min(cs.x,cs.y)*.13);
      vec2 hb = cs*.5-gap;
      float d = sdRoundBox(lp, hb, 2.*uDpr);
      float st = floor(h.g*255./60.+.5);
      float load = h.r;
      float flash = h.b;
      vec3 c = st<.5 ? PH_OK : (st<1.5 ? PH_WARN : PH_CRIT);
      float pulse = st<.5 ? 1. : (st<1.5 ? .72+.28*sin(uTime*3.5) : (fract(uTime*1.4)<.6 ? 1. : .3));
      float outline = smoothstep(1.*uDpr, 0., abs(d));
      float inside = smoothstep(.5, -.5, d);
      float yUp = -lp.y;
      float lvl = -hb.y+2.*hb.y*load;
      float seg = step(.38, fract(yUp/(3.*uDpr)));
      vec3 lamp;
      if(st > 2.5){
        float diag = abs(lp.x*hb.y+lp.y*hb.x)/length(hb);
        lamp = PH_OK*(.16*outline + .14*inside*smoothstep(1.*uDpr, 0., diag));
      } else {
        lamp = c*(.06*inside + .22*outline + .6*inside*step(yUp,lvl)*seg*pulse);
        lamp += c*inside*smoothstep(1.4*uDpr, 0., abs(yUp-lvl))*pulse;
      }
      float cx = pad+(cell.x+.5)*cs.x;
      float behind = scanX-cx;
      lamp *= 1.+.5*(behind>0. ? exp(-behind/(cs.x*1.2)) : 0.) + 1.6*flash;
      col += lamp;
    }
  }
  col += PH_OK*.1*exp(-abs(px.x-scanX)/(1.5*uDpr));
  fragColor = vec4(col, 1.);
}
`;

function gridFor(n, aspect) {
  let best = [n, 1], score = Infinity;
  for (let r = 1; r <= n; r++) {
    const c = Math.ceil(n / r);
    const cellAspect = (aspect * r) / c;
    const sc = Math.abs(Math.log(cellAspect / 0.8)) + (c * r - n) * 0.04;
    if (sc < score) {
      score = sc;
      best = [c, r];
    }
  }
  return best;
}

export function createMatrix(station, options = {}) {
  const { store } = station;
  let tex = null;
  let buf = new Uint8Array(0);
  return {
    frag: FRAG,
    crt: { curve: 0.03, scan: 0.7, bloom: 0.85, decay: 0.85 },
    init(gl, engine) {
      tex = engine.dataTexture({ internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    },
    update(gl, _state, f) {
      const n = store.hostCount;
      // a station may have no nodes yet (still discovering): keep one dark cell
      const [cols, rows] = gridFor(Math.max(1, n), f.w / f.h);
      if (buf.length !== cols * rows * 4) buf = new Uint8Array(cols * rows * 4);
      buf.fill(0);
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        buf[o] = Math.round(store.hostLoads[i] * 255);
        buf[o + 1] = store.hostStates[i] * 60;
        buf[o + 2] = Math.round(Math.exp(-(f.now - store.hostChangeWall[i]) / 1200) * 255);
        buf[o + 3] = 255;
      }
      tex.upload(cols, rows, buf);
      return { uHosts: tex.tex, uGrid: [cols, rows], uScan: (f.time % 4.5) / 4.5 };
    },
    dispose() {
      tex?.dispose();
    },
  };
}
