import { FONT, NARROW } from '../instruments/font5x7.js';

// Vector-beam painter. Instruments with a render() method draw glowing line
// segments and dots, in CSS pixels with a top-left origin. Each segment is one
// instanced quad with a gaussian falloff, blended additively, so overlapping
// strokes build up brightness the way a beam does on phosphor.

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeg;
layout(location=2) in vec4 aCol;
layout(location=3) in float aWidth;
uniform vec2 uRes;
out vec2 vP;
flat out vec4 vSeg;
flat out vec4 vCol;
flat out float vW;
void main(){
  vec2 a = aSeg.xy, b = aSeg.zw, d = b-a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d/len : vec2(1.,0.);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = aWidth*3.2+1.;
  vec2 p = mix(a-dir*r, b+dir*r, aCorner.x*.5+.5) + nrm*aCorner.y*r;
  vP = p; vSeg = aSeg; vCol = aCol; vW = aWidth;
  vec2 clip = p/uRes*2.-1.;
  gl_Position = vec4(clip.x, -clip.y, 0., 1.);
}
`;

const FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vSeg;
flat in vec4 vCol;
flat in float vW;
out vec4 o;
void main(){
  vec2 pa = vP-vSeg.xy, ba = vSeg.zw-vSeg.xy;
  float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-6), 0., 1.);
  float d = length(pa-ba*h);
  o = vec4(vCol.rgb*vCol.a*exp(-d*d/(2.*vW*vW)), 1.);
}
`;

const STRIDE = 9;

export function createVectorPainter(gl, link) {
  const prog = link(VS, FS);
  const uRes = gl.getUniformLocation(prog.p, 'uRes');

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  const B = STRIDE * 4;
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, B, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, B, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, B, 32);
  gl.vertexAttribDivisor(3, 1);
  gl.bindVertexArray(null);

  let data = new Float32Array(STRIDE * 8192);
  let n = 0, w = 1, h = 1, dpr = 1;

  const p = {
    begin(W, H, D) {
      w = W;
      h = H;
      dpr = D;
      n = 0;
    },
    get w() {
      return w / dpr;
    },
    get h() {
      return h / dpr;
    },
    line(x0, y0, x1, y1, c, intensity = 1, width = 0.6) {
      if (intensity <= 0.003) return;
      if ((n + 1) * STRIDE > data.length) {
        const next = new Float32Array(data.length * 2);
        next.set(data);
        data = next;
      }
      const o = n * STRIDE;
      data[o] = x0 * dpr;
      data[o + 1] = y0 * dpr;
      data[o + 2] = x1 * dpr;
      data[o + 3] = y1 * dpr;
      data[o + 4] = c[0];
      data[o + 5] = c[1];
      data[o + 6] = c[2];
      data[o + 7] = intensity;
      data[o + 8] = width * dpr;
      n++;
    },
    dot(x, y, c, intensity = 1, size = 0.8) {
      p.line(x, y, x, y, c, intensity, size);
    },
    poly(pts, c, intensity = 1, width = 0.6, closed = false) {
      for (let i = 1; i < pts.length; i++) p.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c, intensity, width);
      if (closed && pts.length > 2) {
        const a = pts[pts.length - 1], b = pts[0];
        p.line(a[0], a[1], b[0], b[1], c, intensity, width);
      }
    },
    // 5x7 matrix text drawn as beam dots; returns the x after the text
    text(x, y, str, c, intensity = 1, pitch = 1.5) {
      for (const ch of String(str).toUpperCase()) {
        let cols = FONT[ch] ?? FONT['?'];
        if (ch === ' ') cols = [0, 0, 0];
        else if (NARROW.has(ch)) {
          const inked = cols.filter((v) => v);
          cols = inked.length ? inked : [0];
        }
        cols.forEach((bits, i) => {
          for (let r = 0; r < 7; r++) if ((bits >> r) & 1) p.dot(x + i * pitch, y + r * pitch, c, intensity, pitch * 0.3);
        });
        x += (cols.length + 1) * pitch;
      }
      return x;
    },
    textWidth(str, pitch = 1.5) {
      let cols = 0;
      for (const ch of String(str).toUpperCase()) {
        cols += (ch === ' ' ? 3 : NARROW.has(ch) ? (FONT[ch] ?? []).filter((v) => v).length || 1 : 5) + 1;
      }
      return Math.max(0, cols - 1) * pitch;
    },
    flush() {
      if (!n) return;
      gl.useProgram(prog.p);
      gl.uniform2f(uRes, w, h);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * STRIDE), gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
      n = 0;
    },
  };
  return p;
}
