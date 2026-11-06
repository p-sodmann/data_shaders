import { VS, HEADER, PERSIST, DOWN, BLUR, COMPOSITE } from './shaders.js';
import { createVectorPainter } from './vector.js';

// One WebGL2 context renders every screen on the device. A screen is a DOM
// element (its glass) plus an instrument, either a fragment shader:
//
//   { frag, crt?, init?(gl, engine), update(gl, state, frame) -> uniforms, dispose?() }
//
// or a vector-beam drawing (see vector.js):
//
//   { render(gl, state, frame, painter), crt? }
//
// Per frame, per screen: instrument scene -> phosphor persistence -> quarter-res
// bloom -> tube composite into the element's rectangle on the shared canvas.

const DEFAULT_CRT = { curve: 0.03, scan: 0.8, bloom: 0.9, decay: 0.86 };

export function createEngine(canvas, { fps = 60, dpr: dprCap = 2 } = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) throw new Error('This display needs WebGL2.');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  // Live GPU objects, for the debug counter (stats()). Counted at the context
  // so that resources made by instruments and the vector painter are included.
  const live = { textures: 0, framebuffers: 0, programs: 0, buffers: 0 };
  const alive = new WeakSet(); // so a double delete isn't counted twice
  for (const [kind, name] of [['textures', 'Texture'], ['framebuffers', 'Framebuffer'], ['programs', 'Program'], ['buffers', 'Buffer']]) {
    const create = gl[`create${name}`].bind(gl), remove = gl[`delete${name}`].bind(gl);
    gl[`create${name}`] = () => {
      const o = create();
      if (o) {
        alive.add(o);
        live[kind]++;
      }
      return o;
    };
    gl[`delete${name}`] = (o) => {
      if (o && alive.delete(o)) live[kind]--;
      remove(o);
    };
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      console.error(log + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
      throw new Error(`Shader compile failed: ${log}`);
    }
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, VS);

  function link(vsSrc, fsSrc) {
    const p = gl.createProgram();
    const v = vsSrc ? compile(gl.VERTEX_SHADER, vsSrc) : vs;
    const f = compile(gl.FRAGMENT_SHADER, fsSrc);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(f);
    if (vsSrc) gl.deleteShader(v);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return { p, locs: new Map() };
  }
  const program = (fs) => link(null, fs);

  function use(prog, uniforms) {
    gl.useProgram(prog.p);
    let unit = 0;
    for (const name in uniforms) {
      if (!prog.locs.has(name)) prog.locs.set(name, gl.getUniformLocation(prog.p, name));
      const loc = prog.locs.get(name);
      if (loc === null) continue;
      const v = uniforms[name];
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v);
        gl.uniform1i(loc, unit++);
      } else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    }
  }

  function texParams(filter) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function target(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    texParams(gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h };
  }
  const freeTarget = (t) => {
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  };

  // Data textures for instruments.
  function dataTexture({ internal, format, type, filter = gl.NEAREST }) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    texParams(filter);
    let cw = 0, ch = 0;
    return {
      tex,
      upload(w, h, data) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (w !== cw || h !== ch) {
          gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
          cw = w;
          ch = h;
        } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, type, data);
      },
      dispose: () => gl.deleteTexture(tex),
    };
  }

  const post = {
    persist: program(PERSIST),
    down: program(DOWN),
    blur: program(BLUR),
    comp: program(COMPOSITE),
  };

  const vector = createVectorPainter(gl, link);
  gl.bindVertexArray(vao);

  function pass(t, prog, uniforms) {
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    use(prog, uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const screens = new Set();
  const api = { gl, dataTexture };
  let dpr = 1;
  let held = false;

  function alloc(s, w, h) {
    if (s.t) Object.values(s.t).forEach(freeTarget);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    s.t = { scene: target(w, h), a: target(w, h), b: target(w, h), b1: target(bw, bh), b2: target(bw, bh) };
    s.radius = parseFloat(getComputedStyle(s.el).borderTopLeftRadius) || 0;
  }

  function render(s, f, cr) {
    const r = s.el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const x = Math.round((r.left - cr.left) * dpr);
    const y = Math.round((r.top - cr.top) * dpr);
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    // Held (a module is being dragged or resized): the instrument isn't asked
    // for a new frame, and its last picture is composited, stretched if need
    // be, wherever the glass is now.
    if (held && s.last) {
      composite(s, f, x, y, w, h, s.last, s.t.b1);
      return;
    }
    if (!s.t || s.t.scene.w !== w || s.t.scene.h !== h) alloc(s, w, h);
    const { crt, t } = s;
    const common = { uRes: [w, h], uTime: f.time, uDpr: dpr };

    const fi = { ...f, w, h, dpr, cssW: r.width, cssH: r.height };
    if (s.inst.render) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.scene.fbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      vector.begin(w, h, dpr);
      s.inst.render(gl, s.state, fi, vector);
      vector.flush();
    } else {
      const u = s.inst.update(gl, s.state, fi) || {};
      pass(t.scene, s.prog, { ...common, ...u });
    }

    const prev = s.flip ? t.a : t.b;
    const cur = s.flip ? t.b : t.a;
    s.flip = !s.flip;
    pass(cur, post.persist, { ...common, uScene: t.scene.tex, uPrev: prev.tex, uDecay: Math.pow(crt.decay, f.dt * 60) });
    pass(t.b1, post.down, { ...common, uSrc: cur.tex, uTexel: [1 / w, 1 / h] });
    pass(t.b2, post.blur, { ...common, uSrc: t.b1.tex, uDir: [1.5 / t.b1.w, 0] });
    pass(t.b1, post.blur, { ...common, uSrc: t.b2.tex, uDir: [0, 1.5 / t.b1.h] });
    s.last = cur;
    composite(s, f, x, y, w, h, cur, t.b1);
  }

  function composite(s, f, x, y, w, h, img, bloom) {
    const { crt } = s;
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(x, canvas.height - y - h, w, h);
    use(post.comp, {
      uRes: [w, h],
      uTime: f.time,
      uDpr: dpr,
      uAge: (f.now - s.born) / 1000 - s.delay,
      uImg: img.tex,
      uBloom: bloom.tex,
      uCurve: crt.curve,
      uScan: crt.scan,
      uBloomAmt: crt.bloom,
      uRadius: s.radius * dpr,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const t0 = performance.now();
  let raf = 0, last = 0, prevNow = t0;
  const minFrame = 1000 / fps;

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < minFrame - 2) return;
    last = now;
    const dt = Math.min(0.1, (now - prevNow) / 1000);
    prevNow = now;

    dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const cr = canvas.getBoundingClientRect();
    const W = Math.round(cr.width * dpr), H = Math.round(cr.height * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const f = { now, dt, time: ((now - t0) / 1000) % 3600 };
    for (const s of screens) render(s, f, cr);
  }
  raf = requestAnimationFrame(loop);

  // A display that runs for weeks will eventually lose its context (driver
  // reset, GPU switch). Reloading is the most reliable recovery.
  const onLost = (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
  };
  const onRestored = () => location.reload();
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  // screens added together power on in a short cascade
  let lastAdd = -Infinity, cascade = 0;

  return {
    add(el, inst) {
      const now = performance.now();
      cascade = now - lastAdd < 250 ? cascade + 1 : 0;
      lastAdd = now;
      const s = {
        el,
        inst,
        prog: inst.frag ? program(HEADER + inst.frag) : null,
        crt: { ...DEFAULT_CRT, ...inst.crt },
        flip: false,
        t: null,
        born: now,
        delay: cascade * 0.07,
      };
      s.state = inst.init?.(gl, api);
      screens.add(s);
      return () => {
        screens.delete(s);
        if (s.t) Object.values(s.t).forEach(freeTarget);
        if (s.prog) gl.deleteProgram(s.prog.p);
        inst.dispose?.(gl, s.state);
      };
    },
    // While held, screens keep their last frame (the service panel holds the
    // engine during a drag, so moving a module costs no instrument updates).
    hold(on) {
      held = !!on;
    },
    // debug counter: a page switch that leaks shows up as growing numbers here
    stats: () => ({ screens: screens.size, ...live }),
    destroy() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      screens.clear();
    },
  };
}
