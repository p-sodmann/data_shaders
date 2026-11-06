import { FONT, NARROW } from './font5x7.js';

// Generic dot-matrix display. The instrument owns a byte bitmap (one byte per
// dot, value = palette index) that a draw() callback paints every frame; the
// shader renders it as round phosphor dots with faintly visible unlit dots.
//
//   createDotMatrix({ layout(cssW, cssH) -> pitch in css px, draw(api, frame), crt })

const FRAG = `
uniform sampler2D uBits;
uniform vec2 uGrid;
uniform float uPitch;
uniform vec2 uOff;
void main(){
  vec2 px = vec2(vUv.x, 1.-vUv.y)*uRes - uOff;
  vec2 g = px/uPitch;
  vec2 cell = floor(g);
  vec3 col = vec3(0.);
  if(cell.x>=0. && cell.y>=0. && cell.x<uGrid.x && cell.y<uGrid.y){
    float idx = floor(texelFetch(uBits, ivec2(cell), 0).r*255.+.5);
    float m = smoothstep(.47, .3, length(fract(g)-.5));
    col = idx < .5 ? PH_OK*.045*m : palette(idx)*m;
  }
  fragColor = vec4(col, 1.);
}
`;

function glyphColumns(ch, prop) {
  const g = FONT[ch] ?? FONT['?'];
  if (prop && ch === ' ') return [0, 0, 0];
  if (prop && NARROW.has(ch)) {
    const inked = g.filter((c) => c !== 0);
    return inked.length ? inked : [0];
  }
  return g;
}

export function createDotMatrix({ layout, draw, crt }) {
  let tex = null;
  let bits = new Uint8Array(0);
  let gw = 0, gh = 0;

  const dot = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < gw && y < gh) bits[y * gw + x] = c;
  };
  const api = {
    get w() {
      return gw;
    },
    get h() {
      return gh;
    },
    dot,
    // draws a string, returns the x after the last glyph
    text(x, y, str, color, prop = false) {
      for (const raw of str.toUpperCase()) {
        const cols = glyphColumns(raw, prop);
        cols.forEach((bitsCol, i) => {
          for (let r = 0; r < 7; r++) if ((bitsCol >> r) & 1) dot(x + i, y + r, color);
        });
        x += cols.length + 1;
      }
      return x;
    },
    measure(str, prop = false) {
      let w = 0;
      for (const ch of str.toUpperCase()) w += glyphColumns(ch, prop).length + 1;
      return Math.max(0, w - 1);
    },
  };

  return {
    frag: FRAG,
    crt: { curve: 0.015, scan: 0.35, bloom: 1.0, decay: 0.8, ...crt },
    init(gl, engine) {
      tex = engine.dataTexture({ internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE });
      gw = gh = 0;
    },
    update(gl, _state, f) {
      const pitch = layout(f.cssW, f.cssH);
      const nw = Math.max(1, Math.floor(f.cssW / pitch));
      const nh = Math.max(1, Math.floor(f.cssH / pitch));
      if (nw !== gw || nh !== gh) {
        gw = nw;
        gh = nh;
        bits = new Uint8Array(gw * gh);
      }
      bits.fill(0);
      draw(api, f);
      tex.upload(gw, gh, bits);
      const pp = pitch * f.dpr;
      return {
        uBits: tex.tex,
        uGrid: [gw, gh],
        uPitch: pp,
        uOff: [Math.floor((f.w - gw * pp) / 2), Math.floor((f.h - gh * pp) / 2)],
      };
    },
    dispose() {
      tex?.dispose();
    },
  };
}
