import React, { useState } from 'react';
import { stationSchema } from '../../config/schema.js';
import { patchStation } from '../../config/stations.js';
import { REGIONS, region } from '../../data/regions.js';
import { routeLabel } from '../../data/telemetry.js';
import { createProfile } from '../../station/profile.js';
import { Key } from '../device.jsx';
import { Entry, Row } from './controls.jsx';

// One station's settings on the stations plate (step 09): name, thresholds,
// SLO, home, and for a Prometheus station the per-route SLOs and the pipeline
// order. An empty field means the default, which the field shows faintly.
//
// A value is checked before it goes into the document: by the document's own
// schema (the same zod rules a loaded cartridge passes), and against its
// partner (warn below crit), and a refusal is written under that field.
// Threshold changes retune the running station; anything else replaces it
// (station/manager.js).

const DEF = createProfile({});

// [key, label, unit, scale]: fractions are edited as percentages
const THRESH = [
  ['warn', 'P50 warn', 'ms', 1],
  ['crit', 'P50 crit', 'ms', 1],
  ['max', 'Tape scale', 'ms', 1],
  ['errWarn', 'Err warn', '%', 100],
  ['errCrit', 'Err crit', '%', 100],
  ['errMax', 'Err scale', '%', 100],
  ['satWarn', 'Sat warn', '%', 100],
  ['satCrit', 'Sat crit', '%', 100],
  ['tpMax', 'RPS scale', 'rps', 1],
];
// each pair must rise from left to right
const PAIRS = [
  ['warn', 'crit'],
  ['crit', 'max'],
  ['errWarn', 'errCrit'],
  ['errCrit', 'errMax'],
  ['satWarn', 'satCrit'],
];

const show = (v, scale = 1) => (v === undefined || v === null ? '' : String(+(v * scale).toPrecision(6)));
const NaN_ = Symbol('not a number');
// '' → undefined (the default), '1,5' reads as 1.5
function parse(text, scale = 1) {
  if (text === '') return undefined;
  const v = Number(text.replace(',', '.'));
  return Number.isFinite(v) ? v / scale : NaN_;
}

// The refusal for `field` if `entry` can't go into the document, else null.
function check(entry, field) {
  const r = stationSchema.safeParse(entry);
  if (!r.success) {
    const key = (path) => (path[0] === 'endpoints' ? `route:${entry.endpoints[path[1]]?.route}` : path.join('.'));
    const issue = r.error.issues.find((i) => key(i.path) === field) ?? r.error.issues[0];
    return issue.message;
  }
  const t = { ...DEF.thresh, ...entry.thresh };
  for (const [lo, hi] of PAIRS) {
    if (t[lo] < t[hi]) continue;
    if (field === `thresh.${lo}`) return `must stay below ${hi} (${show(t[hi], scaleOf(hi))})`;
    if (field === `thresh.${hi}`) return `must stay above ${lo} (${show(t[lo], scaleOf(lo))})`;
  }
  return null;
}
const scaleOf = (k) => THRESH.find((x) => x[0] === k)[3];

// the region whose position the home is, if any
const homeCode = (home) => (home ? (Object.keys(REGIONS).find((c) => REGIONS[c][1] === home.lat && REGIONS[c][2] === home.lon) ?? '') : '');

// onPatch(patch) → whether the document took it
export function StationEditor({ entry, station, onPatch, onClose }) {
  const [errors, setErrors] = useState({});
  const prom = entry.source.kind === 'prometheus';
  const fail = (field, msg) => setErrors((e) => ({ ...e, [field]: msg }));
  const clear = (field) => setErrors(({ [field]: _, ...e }) => e);

  function apply(field, patch) {
    const msg = check(patchStation(entry, patch), field);
    if (msg) return fail(field, msg);
    if (onPatch(patch)) clear(field);
  }
  // a number field: '' clears it, anything else must read as a number
  const number = (field, scale, set) => (text) => {
    const v = parse(text, scale);
    if (v === NaN_) return fail(field, 'a number');
    apply(field, set(v));
  };
  const entryOf = (field, value, placeholder, onCommit, extra = {}) => (
    <Entry name={field} value={value} placeholder={placeholder} error={errors[field]} onCommit={onCommit} onCancel={() => clear(field)} className="num" {...extra} />
  );

  const setThresh = (k, v) => {
    const thresh = { ...entry.thresh };
    if (v === undefined) delete thresh[k];
    else thresh[k] = v;
    return { thresh };
  };
  const setSlo = (k, v) => {
    const slo = { ...entry.slo };
    if (v === undefined) delete slo[k];
    else slo[k] = v;
    return { slo };
  };
  // home is a pair: one coordinate typed keeps the other (or its default)
  const setHome = (k, v) => {
    if (v === undefined) return { home: undefined };
    return { home: { ...(entry.home ?? DEF.home), [k]: v } };
  };

  // the routes the station found, and any the document names before they have traffic
  const table = station?.store.endpoints ?? [];
  const overrides = entry.endpoints ?? [];
  const routes = [...new Set([...overrides.map((e) => e.route), ...table.map((e) => e.route)])];
  const setRoute = (route, v) => {
    const list = overrides.filter((e) => e.route !== route);
    if (v !== undefined) list.push({ route, slo: v });
    return { endpoints: list };
  };

  // the pipeline as the station runs it: the override first, then the probe's order
  const stages = station?.store.stages ?? entry.stages ?? [];
  const moveUp = (i) => {
    const next = [...stages];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    apply('stages', { stages: next });
  };

  return (
    <section className="settings st-editor" data-station={entry.id}>
      <header className="plate-head">
        <span className="num">{entry.id}</span>
        <span className="name">{entry.name}</span>
        <span className="meta">{prom ? `PROM ${entry.source.station}` : entry.source.kind.toUpperCase()}</span>
      </header>

      <Row label="Name">{entryOf('name', entry.name, '', (t) => apply('name', { name: t }), { maxLength: 24, className: '' })}</Row>

      <div className="st-group">
        <span className="cap">Thresholds</span>
        <div className="st-fields">
          {THRESH.map(([k, label, unit, scale]) => (
            <label key={k} className="st-field">
              <span className="cap">{label}</span>
              {entryOf(`thresh.${k}`, show(entry.thresh?.[k], scale), show(DEF.thresh[k], scale), number(`thresh.${k}`, scale, (v) => setThresh(k, v)))}
              <span className="unit">{unit}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="st-group">
        <span className="cap">SLO · home</span>
        <div className="st-fields">
          <label className="st-field">
            <span className="cap">Target</span>
            {entryOf('slo.target', show(entry.slo?.target, 100), show(DEF.slo.target, 100), number('slo.target', 100, (v) => setSlo('target', v)))}
            <span className="unit">%</span>
          </label>
          <label className="st-field">
            <span className="cap">Window</span>
            {entryOf('slo.days', show(entry.slo?.days), show(DEF.slo.days), number('slo.days', 1, (v) => setSlo('days', v)))}
            <span className="unit">days</span>
          </label>
          <label className="st-field">
            <span className="cap">Region</span>
            {entryOf('home.code', homeCode(entry.home), '–', (t) => {
              if (!t) return apply('home.code', { home: undefined });
              const r = region(t);
              if (!r) return fail('home.code', `no region "${t.toUpperCase()}" in the table`);
              apply('home.code', { home: { lat: r.lat, lon: r.lon } });
            }, { maxLength: 3 })}
            <span className="unit">code</span>
          </label>
          <label className="st-field">
            <span className="cap">Lat</span>
            {entryOf('home.lat', show(entry.home?.lat), show(DEF.home.lat), number('home.lat', 1, (v) => setHome('lat', v)))}
            <span className="unit">°</span>
          </label>
          <label className="st-field">
            <span className="cap">Lon</span>
            {entryOf('home.lon', show(entry.home?.lon), show(DEF.home.lon), number('home.lon', 1, (v) => setHome('lon', v)))}
            <span className="unit">°</span>
          </label>
        </div>
      </div>

      {prom && (
        <div className="st-group">
          <span className="cap">Route SLOs · P95</span>
          {routes.length ? (
            <div className="st-fields">
              {routes.map((route) => {
                const own = overrides.find((e) => e.route === route);
                const auto = table.find((e) => e.route === route && e.auto)?.slo;
                const field = `route:${route}`;
                return (
                  <label key={route} className="st-field route" title={route}>
                    <span className="cap">{routeLabel(route)}</span>
                    {entryOf(field, show(own?.slo), auto ? `${auto}` : 'auto', number(field, 1, (v) => setRoute(route, v)))}
                    <span className="unit">{own ? 'ms' : 'auto'}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <span className="engraved">No routes found yet</span>
          )}
        </div>
      )}

      {prom && (
        <div className="st-group">
          <span className="cap">Pipeline · {entry.stages?.length ? 'order set here' : 'order from the probe'}</span>
          {stages.length ? (
            <div className="st-stages">
              {stages.map((s, i) => (
                <span key={s} className="st-stage">
                  <span className="pos">{i + 1}</span>
                  <span>{s}</span>
                  <Key k="▲" onClick={() => moveUp(i)} disabled={i === 0} className="st-up" />
                </span>
              ))}
            </div>
          ) : (
            <span className="engraved">No stages found yet</span>
          )}
          {errors.stages && <span className="entry-error">{errors.stages}</span>}
        </div>
      )}

      <div className="plate-keys">
        <Key k="◂" onClick={onClose} className="st-back">
          Stations
        </Key>
        {prom && (
          <Key k="↺" onClick={() => apply('stages', { stages: undefined })} disabled={!entry.stages?.length} className="st-probe-order">
            Probe order
          </Key>
        )}
      </div>
    </section>
  );
}
