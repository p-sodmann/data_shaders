
// Signal analysis for page 4. Everything here is derived from the store's
// 4-hour, 1-second signal history; nothing needs new data.
//
//   spectrum   latency amplitude spectrum over 4 h, on a log period axis,
//              with detected rhythms (peaks), their harmonics and next peak
//   live       the same spectrum over the last 10 min, so the display moves
//   waterfall  short-window spectrogram rows, one per 30 s, 4 h deep, with a
//              live top row recomputed every 5 s
//   curve      the latency-vs-saturation operating curve and how far the
//              system currently sits off it
//   corr       correlation matrix of all signals, now (10 min) vs baseline (4 h)
//
// Work is throttled on both simulation and wall time, so a ×60 time base does
// not multiply the cost.

const TAU = Math.PI * 2;
const LAT = 0, SAT = 3;

export const LONG = { step: 5, span: 4 * 3600, pmin: 30, pmax: 7200, bins: 180 };
export const SHORT = { step: 4, span: 1800, pmin: 16, pmax: 600, bins: 96, every: 30, rows: 480 };
// the live trace on the spectrum: the last 10 minutes, periods up to 200 s
// (three cycles), so it reacts within seconds
export const LIVE = { span: 600, pmax: 200 };
export const CURVE_BINS = 40;
const NOW_SPAN = 600;

const periodsOf = ({ pmin, pmax, bins }) =>
  Float64Array.from({ length: bins }, (_, i) => pmax * Math.pow(pmin / pmax, i / (bins - 1)));

// x position (0..1) of a period on an axis: long periods left, short right
export const axisX = (cfg, p) => Math.log(cfg.pmax / p) / Math.log(cfg.pmax / cfg.pmin);

export function fmtPeriod(sec) {
  sec = Math.round(sec);
  const pad = (n) => String(n).padStart(2, '0');
  if (sec >= 3600) return `${Math.floor(sec / 3600)}H${pad(Math.floor(sec / 60) % 60)}M`;
  if (sec >= 60) return `${Math.floor(sec / 60)}M${pad(sec % 60)}S`;
  return `${sec}S`;
}

// Detrended, Hann-windowed samples (gaps filled from the trend), or null when
// less than half the window has data.
function prepare(x) {
  const n = x.length;
  let c = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    if (x[i] !== x[i]) continue;
    c++;
    sx += i;
    sy += x[i];
    sxx += i * i;
    sxy += i * x[i];
  }
  if (c < n * 0.5) return null;
  const den = c * sxx - sx * sx;
  const b = den ? (c * sxy - sx * sy) / den : 0;
  const a = (sy - b * sx) / c;
  const y = new Float64Array(n);
  let W = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1));
    W += w;
    y[i] = x[i] === x[i] ? (x[i] - a - b * i) * w : 0;
  }
  return { y, W };
}

// Amplitude (same unit as the signal) and phase of the sinusoid with period
// p samples. Phase is referenced to sample `ref`.
function dft(y, W, p, ref = 0) {
  const w = TAU / p;
  const c = Math.cos(w), s = Math.sin(w);
  let pr = Math.cos(-w * -ref), pi = Math.sin(-w * -ref); // e^{-iw(0-ref)}
  let re = 0, im = 0;
  for (let i = 0; i < y.length; i++) {
    re += y[i] * pr;
    im += y[i] * pi;
    const t = pr * c + pi * s; // multiply by e^{-iw}
    pi = pi * c - pr * s;
    pr = t;
  }
  return { amp: (2 * Math.hypot(re, im)) / W, phase: Math.atan2(im, re) };
}

// 1 s samples reduced to bins of `step` by median, which drops short spikes
// but keeps anything scheduled that lasts longer than half a bin
function binned(store, k, t0, n, step) {
  const raw = store.window(k, t0, n * step, 1);
  const out = new Float64Array(n);
  const buf = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (let j = 0; j < step; j++) {
      const v = raw[i * step + j];
      if (v === v) buf.push(v);
    }
    out[i] = buf.length ? median(buf) : NaN;
  }
  return out;
}

// trial periods: every 5 s up to 10 min, then every 15 s up to 60 min
// (at least four cycles in the 4 h window)
const TRIALS = [];
for (let p = 60; p < 600; p += 5) TRIALS.push(p);
for (let p = 600; p <= 3600; p += 15) TRIALS.push(p);
// minAmp in ms. minData: the search runs once this many seconds of the window
// have data (a live source starts with only what its backend has kept; four
// cycles of a 5-minute job fit), not only once the 4 h reference is half full.
const RHYTHM = { max: 5, minSig: 6, minAmp: 0.3, minData: 1200 };
// phase bins of about P/40, never finer than two samples
const binsFor = (P) => Math.max(6, Math.min(40, Math.round(P / Math.max(10, P / 40))));

const phaseBin = (t, P, B) => Math.min(B - 1, Math.floor((((t % P) + P) % P) / P * B));

function fold(y, t0, dt, P, B) {
  const sum = new Float64Array(B), cnt = new Float64Array(B), mean = new Float64Array(B);
  let ph = ((((t0 + dt / 2) % P) + P) % P);
  const kb = B / P;
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (v === v) {
      const k = Math.min(B - 1, (ph * kb) | 0);
      sum[k] += v;
      cnt[k]++;
    }
    ph += dt;
    if (ph >= P) ph -= P;
  }
  for (let k = 0; k < B; k++) mean[k] = cnt[k] ? sum[k] / cnt[k] : 0;
  return { mean, cnt };
}

// The same fold with the median across cycles in each phase bin: something
// that happened in only a few cycles (an incident) does not move it.
function foldMedian(y, t0, dt, P, B) {
  const buckets = Array.from({ length: B }, () => []);
  let ph = ((((t0 + dt / 2) % P) + P) % P);
  const kb = B / P;
  for (let i = 0; i < y.length; i++) {
    if (y[i] === y[i]) buckets[Math.min(B - 1, (ph * kb) | 0)].push(y[i]);
    ph += dt;
    if (ph >= P) ph -= P;
  }
  const mean = new Float64Array(B), cnt = new Float64Array(B);
  buckets.forEach((b, k) => {
    cnt[k] = b.length;
    mean[k] = b.length ? median(b) : 0;
  });
  return { mean, cnt };
}

// In which cycles the profile's peak bin actually stands up. A true rhythm
// recurs every cycle since it began; a one-off event folds into a "peak" too,
// but only in one cycle. Returns the earliest cycle from which at least 80 %
// of cycles (and at least four) hit, or -1.
function consistency(y, t0, dt, P, B, mean, med, amp) {
  let kMax = 0;
  for (let k = 1; k < B; k++) if (mean[k] > mean[kMax]) kMax = k;
  const sums = new Map();
  let ph = ((((t0 + dt / 2) % P) + P) % P), cyc = 0;
  const first = t0 + dt / 2 - ph; // start of cycle 0
  for (let i = 0; i < y.length; i++) {
    if (y[i] === y[i] && Math.min(B - 1, ((ph * B) / P) | 0) === kMax) {
      const e = sums.get(cyc) || [0, 0];
      e[0] += y[i];
      e[1]++;
      sums.set(cyc, e);
    }
    ph += dt;
    if (ph >= P) (ph -= P), cyc++;
  }
  const hit = [];
  for (let c = 0; c <= cyc; c++) {
    const e = sums.get(c);
    if (e) hit.push(e[0] / e[1] > med + amp * 0.5 ? 1 : 0);
  }
  for (let start = 0; start <= hit.length - 4; start++) {
    const run = hit.slice(start);
    if (run[0] && run.reduce((a, b) => a + b, 0) >= 0.8 * run.length) return { start, since: first + start * P };
  }
  return null;
}

// subtract a centred running mean of w samples (removes slow wander); null
// unless at least `min` samples (default: half) have data
function highpass(x, w, min = x.length * 0.5) {
  const n = x.length, out = new Float64Array(n);
  let s = 0, c = 0, ok = 0;
  const h = w >> 1;
  for (let i = 0; i < Math.min(n, h); i++) if (x[i] === x[i]) (s += x[i]), c++;
  for (let i = 0; i < n; i++) {
    const add = i + h, drop = i - h - 1;
    if (add < n && x[add] === x[add]) (s += x[add]), c++;
    if (drop >= 0 && x[drop] === x[drop]) (s -= x[drop]), c--;
    out[i] = x[i] === x[i] && c ? x[i] - s / c : NaN;
    if (out[i] === out[i]) ok++;
  }
  return ok >= min && ok > 0 ? out : null;
}

function median(arr) {
  const a = Array.from(arr).sort((p, q) => p - q);
  return a.length ? a[a.length >> 1] : NaN;
}

export function createSignal(store, profile) {
  const { thresh } = profile;
  const SIGNALS = store.signals;
  const longP = periodsOf(LONG);
  const shortP = periodsOf(SHORT);
  // t: last update (-1 before the first); searched: the rhythm search has run;
  // ref: the 4 h reference has enough data (half the window)
  const spec = { amp: new Float32Array(LONG.bins), hold: new Float32Array(LONG.bins), live: new Float32Array(LONG.bins).fill(NaN), t: -1, peaks: [], searched: false, ref: false };
  const fall = { rows: new Uint8Array(SHORT.bins * SHORT.rows), lastRow: -1, liveT: -1, version: 0 };
  const curve = { med: new Float32Array(CURVE_BINS).fill(NaN), hi: new Float32Array(CURVE_BINS).fill(NaN), knee: null, t: -1, cloud: [] };
  const corr = { now: null, base: null, t: -1, tBase: -1 };
  let wallLong = -Infinity, wallCorr = -Infinity, wallRhythm = -Infinity, tRhythm = -Infinity;

  function updateSpectrum(now) {
    const n = LONG.span / LONG.step;
    const t0 = Math.floor((now - LONG.span) / LONG.step) * LONG.step + LONG.step;
    const x = binned(store, LAT, t0, n, LONG.step);
    // A station that just started (a live source) may have far less than 4 h:
    // the reference waits for half the window, the live trace and the rhythm
    // search don't.
    const prep = prepare(x);
    spec.ref = !!prep;
    const half = Math.sqrt(longP[0] / longP[1]); // half a bin, as a ratio
    for (let b = 0; prep && b < LONG.bins; b++) {
      let pw = 0;
      for (const r of [1 / half, 1, half]) pw += dft(prep.y, prep.W, (longP[b] * Math.sqrt(r)) / LONG.step).amp ** 2;
      spec.amp[b] = Math.sqrt(pw / 3);
      spec.hold[b] = Math.max(spec.amp[b], spec.hold[b] * 0.995);
    }
    // live: the last 10 minutes, where at least three cycles fit
    const ln = LIVE.span / LONG.step;
    const lp = prepare(x.subarray(n - ln));
    for (let b = 0; b < LONG.bins; b++) {
      if (!lp || longP[b] > LIVE.pmax) {
        spec.live[b] = NaN;
        continue;
      }
      let pw = 0;
      for (const r of [1 / half, 1, half]) pw += dft(lp.y, lp.W, (longP[b] * Math.sqrt(r)) / LONG.step).amp ** 2;
      // noise amplitude per bin grows as the window shrinks (1/sqrt(N)); scale
      // to the reference's noise floor so live above reference means more
      // energy now, not just a shorter window
      spec.live[b] = Math.sqrt(pw / 3) * Math.sqrt(LIVE.span / LONG.span);
    }
    spec.t = now;
    return { x, t0 };
  }

  // Epoch folding, as in a pulsar search: fold the high-passed series at every
  // trial period and score how far the folded profile stands out of the noise.
  // Candidates are then confirmed from the shortest period up, each confirmed
  // rhythm is subtracted, so a long period that merely contains a shorter one
  // (60 min contains every 10 min) is not reported twice, and a period whose
  // profile grows when folded at 2-4x its length is an alias and is dropped.
  function findRhythms(x, t0, now) {
    const n = x.length, dt = LONG.step;
    // rhythms describe routine behaviour: leave incidents (above WARN) out
    x = x.map((v) => (v > thresh.warn ? NaN : v));
    const hp = highpass(x, Math.round(1200 / dt), RHYTHM.minData / dt);
    if (!hp) return [];
    // clip at 4 robust sigma: an incident should weigh no more than a scheduled bump
    const vals = [];
    for (const v of hp) if (v === v) vals.push(v);
    const m0 = median(vals);
    const rsd = 1.4826 * median(vals.map((v) => Math.abs(v - m0)));
    const lim = 4 * rsd;
    // too small to matter on a latency display
    const minAmp = Math.max(RHYTHM.minAmp, 0.75 * rsd);
    if (lim > 1e-3) for (let i = 0; i < n; i++) if (hp[i] === hp[i]) hp[i] = Math.max(m0 - lim, Math.min(m0 + lim, hp[i]));
    // total variance, bumps included: a fold at an unrelated period then
    // scores about 1, whatever the series contains
    let sv = 0, sc = 0;
    for (const v of hp) if (v === v) (sv += v * v), sc++;
    const sigma = Math.sqrt(sv / Math.max(1, sc)) || 1e-6;
    const score = (P, B = binsFor(P), robust = true, y = hp) => {
      const f = (robust ? foldMedian : fold)(y, t0, dt, P, B);
      let chi = 0, dof = 0;
      for (let k = 0; k < B; k++) {
        if (!f.cnt[k]) continue;
        chi += f.cnt[k] * f.mean[k] * f.mean[k];
        dof++;
      }
      const prof = Array.from(f.mean);
      const med = median(prof);
      return { P, B, f, red: chi / (sigma * sigma) / Math.max(1, dof - 1), amp: Math.max(...prof) - med, med };
    };
    const steady = (c) => consistency(hp, t0, dt, c.P, c.B, c.f.mean, c.med, c.amp);
    const without = (c) => {
      const y = Float64Array.from(hp);
      for (let i = 0; i < n; i++) if (y[i] === y[i]) y[i] -= c.f.mean[phaseBin(t0 + i * dt + dt / 2, c.P, c.B)];
      return y;
    };

    const fine = (P, bw) => score(P, Math.max(6, Math.min(480, Math.round(P / bw))));
    const onGrid = (P) => (P < 600 ? Math.round(P / 5) * 5 : Math.round(P / 15) * 15);
    // Move P to the period that best explains it: a divisor that leaves nothing
    // significant at P once it is removed (P is just a multiple of it), or a
    // multiple whose fold, at the same bin width, is much stronger (P is an
    // alias of it).
    const settle = (P) => {
      for (let guard = 0; guard < 6; guard++) {
        const here = score(P);
        let to = null;
        for (let k = 12; k >= 2 && !to; k--) {
          const q = onGrid(P / k);
          if (q < TRIALS[0]) continue;
          const c = score(q);
          if (c.red >= RHYTHM.minSig && steady(c) && score(P, here.B, true, without(c)).red < RHYTHM.minSig) to = q;
        }
        for (let k = 2; k <= 12 && !to && P * k <= TRIALS[TRIALS.length - 1]; k++) {
          if (fine(P * k, P / here.B).amp >= 1.6 * here.amp) to = P * k;
        }
        if (!to) break;
        P = to;
      }
      return P;
    };

    const out = [];
    for (let pass = 0; pass < RHYTHM.max; pass++) {
      // strongest period that recurs in most of its cycles
      // cheap mean-fold pre-filter, then the robust median fold on the best
      const ranked = TRIALS.map((P) => score(P, binsFor(P), false))
        .sort((a, b) => b.red - a.red)
        .slice(0, 25)
        .map((c) => score(c.P))
        .filter((c) => c.red >= RHYTHM.minSig && c.amp >= minAmp)
        .sort((a, b) => b.red - a.red);
      const top = ranked.find(steady);
      if (!top) break;
      let c = score(settle(top.P));
      // schedulers run on round minutes: prefer one within 2 % that scores as well
      const round = Math.round(c.P / 60) * 60;
      if (c.P >= 300 && round !== c.P && Math.abs(round / c.P - 1) < 0.02) {
        const r = score(round);
        if (r.red >= 0.85 * c.red) c = r;
      }
      const run = steady(c);
      if (c.red < RHYTHM.minSig * 0.7 || c.amp < minAmp || !run || out.some((o) => Math.abs(o.period / c.P - 1) < 0.02)) break;
      const { P, B, f } = c;
      for (let i = 0; i < n; i++) if (hp[i] === hp[i]) hp[i] -= f.mean[phaseBin(t0 + i * dt + dt / 2, P, B)];

      const prof = Array.from(f.mean, (v) => v - c.med);
      let kMax = 0;
      prof.forEach((v, k) => v > prof[kMax] && (kMax = k));
      // parabolic refinement of the peak phase, then the next time it comes round
      const l = prof[(kMax + B - 1) % B], m = prof[kMax], r = prof[(kMax + 1) % B];
      const d = Math.max(-0.5, Math.min(0.5, (l - r) / (2 * (l - 2 * m + r) || 1)));
      let next = Math.floor(now / P) * P + ((kMax + 0.5 + d) / B) * P;
      while (next <= now) next += P;
      while (next - P > now) next -= P;

      // a rhythm that began inside the window is new
      out.push({ period: P, sig: c.red, amp: c.amp, profile: prof, next, since: run.since, fresh: run.start >= 2 });
    }
    return out.sort((a, b) => b.sig - a.sig);
  }

  function waterfallRow(tEnd, replaceTop = false) {
    const n = SHORT.span / SHORT.step;
    const prep = prepare(binned(store, LAT, tEnd - SHORT.span, n, SHORT.step));
    const row = new Uint8Array(SHORT.bins);
    if (prep) {
      const db = Array.from(shortP, (p) => 20 * Math.log10(Math.max(1e-4, dft(prep.y, prep.W, p / SHORT.step).amp)));
      for (let b = 0; b < SHORT.bins; b++) {
        // mostly the excess over the local noise floor (so slow wander does not
        // flood the long-period side), plus a little absolute level so an
        // incident still shows as a bright smear
        const floor = median(db.slice(Math.max(0, b - 10), b + 11));
        const v = Math.max(0, (db[b] - floor - 2) / 12) + 0.25 * Math.max(0, (db[b] + 16) / 26);
        row[b] = Math.round(Math.max(0, Math.min(1, v)) * 255);
      }
    }
    // newest row first
    if (!replaceTop) fall.rows.copyWithin(SHORT.bins, 0, SHORT.bins * (SHORT.rows - 1));
    fall.rows.set(row, 0);
    fall.version++;
  }

  // Row 0 is live (the window ending now); row k >= 1 is the window that
  // ended at lastRow - (k - 1) * every. At each boundary the live row is
  // finalised and a fresh live row is pushed on top.
  function updateWaterfall(now) {
    const last = Math.floor(now / SHORT.every) * SHORT.every;
    if (last > fall.lastRow) {
      let from = fall.lastRow < 0 ? last - (SHORT.rows - 2) * SHORT.every : fall.lastRow + SHORT.every;
      from = Math.max(from, last - (SHORT.rows - 2) * SHORT.every);
      for (let t = from; t <= last; t += SHORT.every) {
        if (fall.lastRow >= 0 && t === from) waterfallRow(t, true);
        else waterfallRow(t);
      }
      waterfallRow(now);
      fall.lastRow = last;
      fall.liveT = now;
    } else if (now - fall.liveT >= 5) {
      waterfallRow(now, true);
      fall.liveT = now;
    }
  }

  function updateCurve(now) {
    const n = LONG.span;
    const t0 = now - n + 1;
    const lat = store.window(LAT, t0, n, 1), sat = store.window(SAT, t0, n, 1);
    const bins = Array.from({ length: CURVE_BINS }, () => []);
    const cloud = [];
    for (let i = 0; i < n; i++) {
      if (lat[i] !== lat[i] || sat[i] !== sat[i]) continue;
      // the curve is learned from healthy operation only; incidents would
      // otherwise teach it that high latency at high load is normal
      if (lat[i] <= thresh.warn) bins[Math.min(CURVE_BINS - 1, Math.floor(sat[i] * CURVE_BINS))].push(lat[i]);
      if (i % 6 === 0) cloud.push(sat[i], lat[i]);
    }
    let low = null;
    bins.forEach((b, k) => {
      if (b.length < 30) {
        curve.med[k] = curve.hi[k] = NaN;
        return;
      }
      b.sort((p, q) => p - q);
      curve.med[k] = b[b.length >> 1];
      curve.hi[k] = b[Math.floor(b.length * 0.9)];
      if (low == null) low = curve.med[k];
    });
    // knee: where the typical latency first reaches 1.5x its unloaded value
    curve.knee = null;
    for (let k = 0; k < CURVE_BINS; k++) {
      if (low != null && curve.med[k] >= low * 1.5) {
        curve.knee = (k + 0.5) / CURVE_BINS;
        break;
      }
    }
    curve.cloud = cloud;
    curve.t = now;
  }

  function pearson(t0, n) {
    const m = SIGNALS.length;
    const xs = SIGNALS.map((_, k) => store.window(k, t0, n, 1));
    const r = new Float32Array(m * m).fill(NaN);
    for (let a = 0; a < m; a++) {
      for (let b = 0; b <= a; b++) {
        let c = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
        const A = xs[a], B = xs[b];
        for (let i = 0; i < n; i++) {
          const x = A[i], y = B[i];
          if (x !== x || y !== y) continue;
          c++;
          sa += x;
          sb += y;
          saa += x * x;
          sbb += y * y;
          sab += x * y;
        }
        if (c < n * 0.3) continue;
        const va = saa - (sa * sa) / c, vb = sbb - (sb * sb) / c;
        const v = va > 1e-12 && vb > 1e-12 ? (sab - (sa * sb) / c) / Math.sqrt(va * vb) : NaN;
        r[a * m + b] = r[b * m + a] = v;
      }
    }
    return r;
  }

  function updateCorr(now) {
    corr.now = pearson(now - NOW_SPAN + 1, NOW_SPAN);
    // the habit: the median of the 24 ten-minute correlations in the last 4 h,
    // so one big incident does not define what "usual" is
    if (corr.tBase < 0 || now - corr.tBase >= 60) {
      const m = SIGNALS.length;
      const wins = [];
      for (let k = 1; k <= LONG.span / NOW_SPAN; k++) wins.push(pearson(now - k * NOW_SPAN + 1, NOW_SPAN));
      corr.base = new Float32Array(m * m).fill(NaN);
      for (let i = 0; i < m * m; i++) {
        const vals = wins.map((w) => w[i]).filter((x) => x === x);
        if (vals.length >= 6) corr.base[i] = median(vals);
      }
      corr.tBase = now;
    }
    corr.t = now;
  }

  return {
    spec,
    fall,
    curve,
    corr,
    longP,
    shortP,
    // called by every page-4 instrument each frame; cheap when nothing is due
    update(wall) {
      const now = store.latest?.t;
      if (now == null) return;
      if (spec.t < 0 || (now - spec.t >= 5 && wall - wallLong >= 1000)) {
        wallLong = wall;
        const series = updateSpectrum(now);
        // the rhythm search is the expensive part: once a minute of data, at most every 8 s
        if (series && (tRhythm < 0 || (now - tRhythm >= 60 && wall - wallRhythm >= 8000))) {
          spec.peaks = findRhythms(series.x, series.t0, now);
          spec.searched = true;
          tRhythm = now;
          wallRhythm = wall;
        }
        updateCurve(now);
      }
      if (now - fall.lastRow >= SHORT.every || now - fall.liveT >= 5) updateWaterfall(now);
      if (corr.t < 0 || (now - corr.t >= 2 && wall - wallCorr >= 500)) {
        wallCorr = wall;
        updateCorr(now);
      }
    },
  };
}
