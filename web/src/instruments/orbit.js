import { SERVICES, LINKS, HUB, THRESH } from '../config.js';
import { PH, STATE_COLORS } from '../gl/palette.js';
import { camera, rotate, SOLIDS, hash } from './space.js';

// 08 ORBIT: the service topology as a slowly turning constellation.
// Each service is a wireframe solid (size = load, colour = worst host state),
// its hosts orbit it as satellites, and packets travel along the call links at
// a density proportional to throughput. Packets into an unhealthy service glow
// in its colour.

const TAU = Math.PI * 2;
const SHAPES = ['octa', 'cube', 'tetra'];

const positions = SERVICES.map((_, i) => {
  if (i === HUB) return [0, 0, 0];
  const k = i < HUB ? i : i - 1;
  const a = (TAU * k) / (SERVICES.length - 1) + 0.35;
  return [Math.cos(a) * 1.65, Math.sin(k * 2.1) * 0.32, Math.sin(a) * 1.65];
});

const stars = Array.from({ length: 160 }, (_, i) => {
  const r = 1.2 + hash(i) * 1.6, a = hash(i + 500) * TAU, y = (hash(i + 900) - 0.5) * 1.6;
  return [Math.cos(a) * r, y, Math.sin(a) * r, hash(i + 1300)];
});

export function createOrbit(store) {
  return {
    crt: { curve: 0.03, scan: 0.75, bloom: 1.05, decay: 0.8 },
    render(gl, _state, f, v) {
      const W = v.w, H = v.h, t = f.time;
      const cam = camera({
        yaw: (t * TAU) / 300,
        pitch: 0.36,
        dist: 6,
        cx: W * 0.5,
        cy: H * 0.5,
        scale: Math.min(W * 0.36, H * 0.56) * 3.1,
      });
      const kRef = cam(0, 0, 0)[3];
      const depth = (k) => Math.min(1.15, Math.max(0.35, 0.55 + 0.45 * (k / kRef - 0.75) * 2));

      // frame furniture: crosshair axis and edge ticks
      const dim = PH.ok;
      v.line(W / 2, H * 0.08, W / 2, H * 0.92, dim, 0.07, 0.5);
      v.line(W / 2 - 8, H * 0.08, W / 2 + 8, H * 0.08, dim, 0.25, 0.5);
      v.line(W / 2 - 8, H * 0.92, W / 2 + 8, H * 0.92, dim, 0.25, 0.5);
      for (const x of [W * 0.06, W * 0.94]) {
        v.line(x, H / 2 - 10, x, H / 2 + 10, dim, 0.3, 0.5);
        v.line(x - 10 * Math.sign(W / 2 - x) * -1, H / 2, x, H / 2, dim, 0.3, 0.5);
      }

      // orbit rings
      for (const [r, n, inten] of [[2.15, 220, 0.22], [1.65, 160, 0.1]]) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          const p = cam(Math.cos(a) * r, 0, Math.sin(a) * r);
          v.dot(p[0], p[1], dim, inten * depth(p[3]), 0.45);
        }
      }

      for (const s of stars) {
        const p = cam(s[0], s[1], s[2]);
        v.dot(p[0], p[1], dim, (0.08 + 0.2 * s[3]) * depth(p[3]) * (0.7 + 0.3 * Math.sin(t * 0.7 + s[3] * 40)), 0.5);
      }

      const svc = store.services;
      const proj = positions.map((p) => cam(...p));

      // links and packets
      const traffic = Math.min(1, (store.latest?.throughput ?? 0) / THRESH.tpMax);
      const err = store.latest?.errorRate ?? 0;
      LINKS.forEach(([a, b], li) => {
        const A = proj[a], B = proj[b];
        const bad = Math.max(svc[a].state, svc[b].state);
        v.line(A[0], A[1], B[0], B[1], STATE_COLORS[bad], bad ? 0.22 : 0.13, 0.5);
        const count = 1 + Math.round(traffic * 6);
        for (let j = 0; j < count; j++) {
          const u = (t * 0.22 + j / count + hash(li) ) % 1;
          const x = A[0] + (B[0] - A[0]) * u, y = A[1] + (B[1] - A[1]) * u;
          const failing = hash(li * 31 + j + Math.floor(t * 0.22 + j / count)) < err * 12;
          const c = failing ? PH.crit : STATE_COLORS[svc[b].state];
          v.dot(x, y, c, 0.9 * Math.sin(Math.PI * u) + 0.1, 0.9);
        }
      });

      // services
      svc.forEach((sv, i) => {
        const [px, py, , k] = proj[i];
        const dk = depth(k);
        const shape = i === HUB ? SOLIDS.ico : SOLIDS[SHAPES[i % SHAPES.length]];
        const size = (i === HUB ? 0.36 : 0.17) * (0.8 + 0.5 * sv.load);
        const spin = t * (0.25 + 0.05 * i) + i;
        const c = STATE_COLORS[sv.state];
        const pulse = sv.state === 2 ? 0.55 + 0.45 * (Math.sin(t * 6) > 0 ? 1 : 0) : sv.state === 1 ? 0.8 + 0.2 * Math.sin(t * 3) : 1;
        const pts = shape.verts.map((vv) => {
          const r = rotate(vv, spin, 0.5 + i);
          return cam(positions[i][0] + r[0] * size, positions[i][1] + r[1] * size, positions[i][2] + r[2] * size);
        });
        for (const [a, b] of shape.edges) v.line(pts[a][0], pts[a][1], pts[b][0], pts[b][1], c, 0.5 * dk * pulse, 0.55);
        for (const p of pts) v.dot(p[0], p[1], c, 0.55 * dk * pulse, 0.7);
        if (sv.state > 0) v.dot(px, py, c, 0.9 * pulse, 2.2);

        // host satellites
        const m = sv.hosts.length;
        sv.hosts.forEach((h, j) => {
          const a = t * 0.6 + (j / m) * TAU + i;
          const r = size * 1.9;
          const p = cam(positions[i][0] + Math.cos(a) * r, positions[i][1] + Math.sin(a * 0.5) * r * 0.25, positions[i][2] + Math.sin(a) * r);
          const st = store.hostStates[h];
          if (st === 3) v.dot(p[0], p[1], PH.ok, 0.08, 0.6);
          else v.dot(p[0], p[1], STATE_COLORS[st], 0.75 * dk, 0.65);
        });

        const label = sv.name;
        v.line(px + size * k * 1.2, py, px + size * k * 1.2 + 10, py - 10, sv.state ? c : PH.ok, 0.25 * dk, 0.45);
        v.text(px + size * k * 1.2 + 13, py - 15, label, sv.state ? c : PH.ok, sv.state ? 0.95 : 0.55 * dk, 1.45);
      });

      // corner readout
      const avail = (1 - err) * 100;
      const linksUp = LINKS.filter(([a, b]) => Math.max(svc[a].state, svc[b].state) < 2).length;
      const lines = [
        ['N', `${String(SERVICES.length).padStart(3)} SERVICES`],
        ['L', `${String(linksUp).padStart(3)}/${LINKS.length} LINKS`],
        ['S', `${avail.toFixed(3)} %`],
      ];
      lines.forEach(([a, b], i) => {
        const y = H - 14 - (lines.length - i) * 17;
        v.text(16, y, a, PH.ok, 0.55, 1.8);
        v.text(36, y, b, PH.ok, 0.95, 1.8);
      });
      const scaleY = H - 22;
      for (let i = 0; i <= 10; i++) v.line(W - 90 + i * 7, scaleY, W - 90 + i * 7, scaleY - (i % 5 ? 3 : 7), PH.ok, 0.3, 0.45);
      v.line(W - 90, scaleY, W - 20, scaleY, PH.ok, 0.3, 0.45);
    },
  };
}
