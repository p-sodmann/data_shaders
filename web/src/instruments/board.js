import { gridFor } from './matrix.js';
import { glyphColumns } from './dotmatrix.js';
import { CODE, stationCode, numerals } from './stations.js';

// STATION BOARD: the nodes lamp bank (matrix.js) with one large lamp per
// station. The fill is saturation, the colour is the station's state, warn
// breathes, crit blinks, and a STALE station goes dark and is struck through.
// Each lamp carries the station's name and, below it, its P50 and RPS: dot-font
// text from a second texture, lit on a dark plate that the fill doesn't light.
//
// Per frame this uploads one texel per station. The label texture is only
// redrawn when a label or the face size changes (about once a second, when the
// numerals move), so 16 stations cost the same shader pass as 2.

const FRAG = `
uniform sampler2D uLamps;
uniform sampler2D uLabels;
uniform vec2 uGrid;
uniform vec2 uLabelGrid;
uniform float uPitch;
uniform float uScan;

void main(){
  vec2 px = vec2(vUv.x, 1.-vUv.y)*uRes;
  float pad = 9.*uDpr;
  vec2 cs = (uRes-2.*pad)/uGrid;
  vec2 g = (px-pad)/cs;
  vec2 cell = floor(g);
  vec3 col = vec3(0.);
  float scanX = pad+uScan*(uRes.x-2.*pad);

  // engraving: 1 = name, 2 = numerals, 3 = the plate behind a line of text,
  // which the fill doesn't light, so the lit dots read the same at any level
  vec2 lg = px/uPitch;
  float lab = 0.;
  if(lg.x>=0. && lg.y>=0. && lg.x<uLabelGrid.x && lg.y<uLabelGrid.y) lab = floor(texelFetch(uLabels, ivec2(lg), 0).r*255.+.5);
  float band = step(.5, lab);
  float dotm = lab > .5 && lab < 2.5 ? smoothstep(.5, .28, length(fract(lg)-.5)) : 0.;

  if(cell.x>=0. && cell.y>=0. && cell.x<uGrid.x && cell.y<uGrid.y){
    vec4 h = texelFetch(uLamps, ivec2(cell), 0);
    if(h.a > .5){
      vec2 lp = (fract(g)-.5)*cs;
      float gap = max(3.*uDpr, min(cs.x,cs.y)*.13);
      vec2 hb = cs*.5-gap;
      float d = sdRoundBox(lp, hb, 3.*uDpr);
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
        lamp = PH_OK*(.16*outline + .14*inside*smoothstep(1.2*uDpr, 0., diag));
        lamp += PH_OK*.2*inside*dotm;
      } else {
        float lit = inside*step(yUp,lvl)*(1.-band);
        lamp = c*(.06*inside*(1.-band) + .22*outline + .6*lit*seg*pulse);
        lamp += c*inside*(1.-band)*smoothstep(1.4*uDpr, 0., abs(yUp-lvl))*pulse;
        lamp += c*dotm*inside*(lab<1.5 ? .9 : .6)*pulse;
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

// lamps are wider than a node lamp, for the names
const LAMP_ASPECT = 1.5;

const textWidth = (str) => {
  let w = 0;
  for (const ch of str) w += glyphColumns(ch, true).length + 1;
  return Math.max(0, w - 1);
};

// the longest prefix of str that fits in `room` dots
function fit(str, room) {
  let s = str;
  while (s && textWidth(s) > room) s = s.slice(0, -1);
  return s;
}

// The lamp rectangles in css px, as the shader draws them (pad, gap), and
// the dot pitch of the engraving: as large as the shortest lamp and the
// longest name allow, the same on every lamp.
export function boardLayout(names, cols, rows, cssW, cssH) {
  const pad = 9;
  const csX = (cssW - 2 * pad) / cols, csY = (cssH - 2 * pad) / rows;
  const gap = Math.max(3, Math.min(csX, csY) * 0.13);
  const longest = Math.max(1, ...names.map((s) => textWidth(s)));
  const pitch = Math.max(1, Math.min(3.5, (csY - 2 * gap) / 22, ((csX - 2 * gap) * 0.86) / longest));
  const lamps = names.map((_, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    return { x: pad + c * csX + gap, y: pad + r * csY + gap, w: csX - 2 * gap, h: csY - 2 * gap };
  });
  return { pitch, lamps };
}

export function createStationBoard(device, options = {}) {
  let lampTex = null, labelTex = null;
  let lampBuf = new Uint8Array(0), labelBuf = new Uint8Array(0);
  let labelKey = '', labelGrid = [1, 1], pitch = 1;
  const changed = new Map(); // station id → [code, wall time of the last change]

  function drawLabels(labels, cols, rows, f) {
    const { pitch: p, lamps } = boardLayout(labels.map((l) => l[0]), cols, rows, f.cssW, f.cssH);
    const gw = Math.max(1, Math.floor(f.cssW / p)), gh = Math.max(1, Math.floor(f.cssH / p));
    if (labelBuf.length !== gw * gh) labelBuf = new Uint8Array(gw * gh);
    labelBuf.fill(0);
    const text = (str, cx, y, v) => {
      let x = Math.round(cx - textWidth(str) / 2);
      // the band: one dot around the line, under the glyphs
      for (let r = y - 1; r < y + 8; r++) {
        if (r < 0 || r >= gh) continue;
        for (let c = Math.max(0, x - 2); c < Math.min(gw, x + textWidth(str) + 2); c++) labelBuf[r * gw + c] = 3;
      }
      for (const ch of str) {
        for (const col of glyphColumns(ch, true)) {
          for (let r = 0; r < 7; r++) {
            if ((col >> r) & 1 && x >= 0 && x < gw && y + r >= 0 && y + r < gh) labelBuf[(y + r) * gw + x] = v;
          }
          x++;
        }
        x++;
      }
    };
    labels.forEach(([name, line], i) => {
      const l = lamps[i];
      const room = Math.floor((l.w * 0.86) / p);
      const cx = (l.x + l.w / 2) / p;
      const two = line.length > 0 && l.h / p >= 22;
      const top = Math.round((l.y + l.h / 2) / p - (two ? 9 : 3.5));
      text(fit(name, room), cx, top, 1);
      if (two) text(fit(line.find((form) => textWidth(form) <= room) ?? line.at(-1), room), cx, top + 11, 2);
    });
    labelGrid = [gw, gh];
    pitch = p;
    labelTex.upload(gw, gh, labelBuf);
  }

  return {
    frag: FRAG,
    crt: { curve: 0.03, scan: 0.7, bloom: 0.85, decay: 0.85 },
    init(gl, engine) {
      lampTex = engine.dataTexture({ internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
      labelTex = engine.dataTexture({ internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE });
      labelKey = '';
    },
    update(gl, _state, f) {
      const stations = device.stations;
      const n = stations.length;
      const [cols, rows] = gridFor(Math.max(1, n), f.w / f.h, LAMP_ASPECT);
      if (lampBuf.length !== cols * rows * 4) lampBuf = new Uint8Array(cols * rows * 4);
      lampBuf.fill(0);
      const labels = [];
      stations.forEach((st, i) => {
        const code = stationCode(st);
        const last = changed.get(st.id);
        if (!last || last[0] !== code) changed.set(st.id, [code, last ? f.now : -Infinity]);
        const sat = st.store.latest?.saturation ?? 0;
        const o = i * 4;
        lampBuf[o] = code === CODE.STALE ? 0 : Math.round(Math.min(1, Math.max(0, sat)) * 255);
        lampBuf[o + 1] = code * 60;
        lampBuf[o + 2] = Math.round(Math.exp(-(f.now - changed.get(st.id)[1]) / 1200) * 255);
        lampBuf[o + 3] = 255;
        labels.push([st.name.toUpperCase(), options.numerals === false ? [] : numerals(st, code)]);
      });
      if (changed.size > n) for (const id of changed.keys()) if (!stations.some((s) => s.id === id)) changed.delete(id);
      lampTex.upload(cols, rows, lampBuf);
      const key = `${cols}x${rows}|${f.cssW}x${f.cssH}|${labels.flat(2).join('|')}`;
      if (key !== labelKey) {
        labelKey = key;
        drawLabels(labels, cols, rows, f);
      }
      return { uLamps: lampTex.tex, uLabels: labelTex.tex, uGrid: [cols, rows], uLabelGrid: labelGrid, uPitch: pitch * f.dpr, uScan: (f.time % 4.5) / 4.5 };
    },
    dispose() {
      lampTex?.dispose();
      labelTex?.dispose();
    },
  };
}
