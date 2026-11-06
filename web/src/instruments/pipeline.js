import { PH, STATE_COLORS } from '../gl/palette.js';

// 10 PIPELINE: requests flow through the serving stages as beam particles.
// Particles move slowly through a stage that is taking more than its normal
// share of latency, so a choking stage visibly builds a queue and glows.
// Failed requests drop out of the stream in orange.

export function createPipeline(station, options = {}) {
  const { store } = station;
  const { thresh } = station.profile;
  const parts = [];
  let spawn = 0;
  let seed = 1;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  return {
    crt: { curve: 0.02, scan: 0.8, bloom: 1.0, decay: 0.78 },
    render(gl, _state, f, v) {
      const W = v.w, H = v.h, t = f.time;
      const dt = f.dt;
      const latest = store.latest;
      // the store's tables: a discovered station may gain a stage while it runs
      const { stages, stageShare } = store;
      const S = stages.length;
      if (S < 2) {
        const msg = S ? stages[0].toUpperCase() : 'NO STAGES REPORTED';
        v.text((W - v.textWidth(msg, 1.6)) / 2, H / 2 - 5, msg, PH.ok, 0.5, 1.6);
        return;
      }
      const stage = store.stageLatency?.length === S ? store.stageLatency : stageShare.map((s) => s * (latest?.latency ?? 10));
      const total = stage.reduce((a, b) => a + b, 0) || 1;
      const ratio = stage.map((ms, k) => ms / total / stageShare[k]);
      const level = ratio.map((r) => (r > 3 ? 2 : r > 1.8 ? 1 : 0));

      const L = 40, R = W - 30;
      const gap = (R - L) / (S - 1);
      const cy = H * 0.44;
      const ph = Math.min(H * 0.56, gap * 1.1);
      const pw = Math.min(gap * 0.32, ph * 0.5);
      const sk = ph * 0.2;
      const planeX = (k) => L + k * gap;

      // left scale
      for (let i = 0; i <= 8; i++) {
        const yy = cy - ph / 2 + (i / 8) * ph;
        v.line(10, yy, i % 4 ? 13 : 17, yy, PH.ok, 0.3, 0.45);
      }

      for (let k = 0; k < S; k++) {
        const x = planeX(k);
        const c = STATE_COLORS[level[k]];
        const pulse = level[k] ? 0.75 + 0.25 * Math.sin(t * (level[k] === 2 ? 7 : 3)) : 1;
        const TL = [x - pw / 2, cy - ph / 2], TR = [x + pw / 2, cy - ph / 2 - sk];
        const BR = [x + pw / 2, cy + ph / 2 - sk], BL = [x - pw / 2, cy + ph / 2];
        v.poly([TL, TR, BR, BL], c, (0.6 + 0.25 * Math.max(0, Math.min(2, ratio[k] - 1))) * pulse, 0.55, true);
        if (k === 0) {
          // ingress plane is hatched
          const at = (s, u) => [TL[0] + s * (TR[0] - TL[0]) + u * (BL[0] - TL[0]), TL[1] + s * (TR[1] - TL[1]) + u * (BL[1] - TL[1])];
          for (let cc = -0.9; cc <= 0.9; cc += 0.15) {
            const a = at(Math.max(0, cc), Math.max(0, -cc)), b = at(Math.min(1, 1 + cc), Math.min(1, 1 - cc));
            v.line(a[0], a[1], b[0], b[1], c, 0.22, 0.45);
          }
        }
        const name = stages[k].toUpperCase();
        v.text(x - v.textWidth(name, 1.45) / 2, cy + ph / 2 + 8, name, level[k] ? c : PH.ok, level[k] ? 0.9 : 0.45, 1.45);
        const ms = stage[k].toFixed(1);
        v.text(x - v.textWidth(ms, 1.45) / 2, cy + ph / 2 + 22, ms, c, 0.8, 1.45);
      }

      // particles
      const tp = latest?.throughput ?? 0;
      spawn += dt * Math.min(40, (tp / thresh.tpMax) * 30);
      while (spawn >= 1 && parts.length < 140) {
        spawn -= 1;
        const fail = rnd() < (latest?.errorRate ?? 0) * 14;
        parts.push({ p: 0, lane: rnd() < 0.5 ? -1 : 1, jitter: rnd(), failAt: fail ? 1 + rnd() * (S - 2) : -1, dead: -1 });
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        const k = Math.min(S - 2, Math.floor(q.p));
        let x = planeX(k) + (q.p - k) * gap;
        let y = cy + q.lane * ph * 0.14 + (q.jitter - 0.5) * 3 - sk * ((x - L) / (R - L)) * 0.2;
        if (q.dead >= 0) {
          q.dead += dt;
          y += q.dead * q.dead * 60;
          v.dot(x, y, PH.crit, Math.max(0, 1 - q.dead * 1.2), 1.1);
          if (q.dead > 0.9) parts.splice(i, 1);
          continue;
        }
        // speed falls inside slow stages
        const r = ratio[Math.min(S - 1, Math.round(q.p))];
        q.p += (dt * 0.9) / Math.max(0.6, r);
        if (q.failAt > 0 && q.p >= q.failAt) q.dead = 0;
        if (q.p >= S - 1) {
          parts.splice(i, 1);
          continue;
        }
        v.dot(x, y, PH.ok, 0.85, 0.9);
      }

      v.text(L - 20, 8, `${Math.round(tp)} REQ/S`, PH.ok, 0.45, 1.45);
      const slow = level.indexOf(Math.max(...level));
      if (level[slow] > 0) {
        const msg = `BOTTLENECK ${stages[slow].toUpperCase()} X${ratio[slow].toFixed(1)}`;
        v.text(R - v.textWidth(msg, 1.45), 8, msg, STATE_COLORS[level[slow]], 0.9, 1.45);
      }
    },
  };
}
