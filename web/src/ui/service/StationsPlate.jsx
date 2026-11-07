import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addStandardPages } from '../../config/edit.js';
import { defaultDoc } from '../../config/load.js';
import {
  addStation,
  cartridgeName,
  cartridgeText,
  mergeDocs,
  promStation,
  readCartridge,
  removeStation,
  setPrometheusUrl,
  stationUsage,
  unclaimed,
  updateStation,
} from '../../config/stations.js';
import { createPromClient } from '../../data/prometheus/client.js';
import { readouts, stationValues } from '../../data/prometheus/stations.js';
import { Key } from '../device.jsx';
import { Entry, StationLamp } from './controls.jsx';
import { StationEditor } from './StationEditor.jsx';

// The stations plate (step 09): an engraved table of the document's stations,
// the Prometheus it reads from, the stations that Prometheus knows and the
// device doesn't show yet (Available), and the cartridge keys: export, import
// (also by dropping a file on the device) and reset.
//
// Every change goes through edit(fn), so it is validated, saved and undoable
// like any layout edit; an import or a removal that rebinds panels is one
// undo step.

const POLL_MS = 2000;
const CONFIRM_MS = 3000;

// What the plate reads from Prometheus while it is open: whether it answers
// (and which version), its stations, and their live P50 and RPS.
function usePrometheus(url) {
  const [state, setState] = useState({ contact: null, version: null, values: null, live: new Map() });
  useEffect(() => {
    const client = createPromClient({ url, timeout: 3000 });
    let alive = true;
    let timer = null;
    const tick = async () => {
      const [info, values, live] = await Promise.allSettled([client.buildinfo(), stationValues(client), readouts(client)]);
      if (!alive) return;
      setState({
        contact: info.status === 'fulfilled',
        version: info.value?.version ?? null,
        values: values.status === 'fulfilled' ? values.value : null,
        live: live.status === 'fulfilled' ? live.value : new Map(),
      });
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url]);
  return state;
}

// a second press within 3 s confirms; returns [armed, press]
function useConfirm() {
  const [armed, setArmed] = useState(null);
  useEffect(() => {
    if (armed === null) return undefined;
    const id = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [armed]);
  return [armed, setArmed];
}

const fmt = (v, digits = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits));
const sourceOf = (s) =>
  s.source.kind === 'prometheus' ? `PROM ${s.source.station}` : s.source.kind === 'sim' ? `SIM${s.source.seed != null ? ` #${s.source.seed}` : ''}` : 'POLL';

export function StationsPlate({ doc, stations, edit, onPage, cartridge, onCartridge }) {
  const url = doc.prometheus?.url ?? '/prom';
  const prom = usePrometheus(url);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [armed, arm] = useConfirm();
  const [offer, setOffer] = useState(null); // a station just added: also its standard pages?
  const fileRef = useRef(null);

  // undefined once the station is gone (undo, say): the table shows again
  const entry = doc.stations.find((s) => s.id === editing);

  const available = useMemo(() => (prom.values ? unclaimed(doc, prom.values) : []), [doc, prom.values]);

  function add(value) {
    let id = null;
    const ok = edit((d) => {
      const s = promStation(d, value);
      id = s.id;
      return addStation(d, s);
    });
    if (ok) setOffer(id);
  }

  function remove(id, how) {
    if (edit((d) => removeStation(d, id, how))) setRemoving(null);
  }
  function pressRemove(id) {
    if (stationUsage(doc, id).length) return setRemoving(removing === id ? null : id);
    if (armed !== `remove:${id}`) return arm(`remove:${id}`);
    arm(null);
    remove(id, {});
  }

  function download() {
    const blob = new Blob([cartridgeText(doc)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = cartridgeName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function reset() {
    if (armed !== 'reset') return arm('reset');
    arm(null);
    if (edit(() => defaultDoc())) onPage(1);
  }
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onCartridge({ name: file.name, text: await file.text() });
  }

  if (entry) {
    return (
      <StationEditor
        key={entry.id}
        entry={entry}
        station={stations[entry.id]}
        onPatch={(patch) => edit((d) => updateStation(d, entry.id, patch))}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <section className="settings st-plate">
      <header className="plate-head">
        <span className="name">Stations</span>
        <span className="meta">{doc.stations.length} on this device</span>
      </header>

      <div className="st-prom">
        <span className="cap">Prometheus</span>
        <Entry name="prometheus" value={url} className="plain" onCommit={(t) => edit((d) => setPrometheusUrl(d, t))} />
        <span className="st-contact">
          <i className={`lamp small ${prom.contact ? 'NOMINAL' : 'STALE'}`} />
          <span className="cap">{prom.contact === null ? 'Calling' : prom.contact ? `Contact · v${prom.version}` : 'No contact'}</span>
        </span>
      </div>

      <div className="st-table" role="table">
        <div className="st-row st-caps" role="row">
          <span />
          <span className="cap">Name</span>
          <span className="cap">Source</span>
          <span className="cap num">Nodes</span>
          <span className="cap num">RPS</span>
          <span />
        </div>
        {doc.stations.map((s) => {
          const st = stations[s.id];
          const live = s.source.kind === 'prometheus' ? prom.live.get(s.source.station) : null;
          const rps = live ? live.rps : st?.store.latest?.throughput;
          const used = stationUsage(doc, s.id).length;
          return (
            <React.Fragment key={s.id}>
              <div className="st-row" role="row" data-station={s.id}>
                <StationLamp station={st} />
                <span className="st-name">{s.name}</span>
                <span className="st-src">{sourceOf(s)}</span>
                <span className="num">{st ? st.store.hostCount : '–'}</span>
                <span className="num">{fmt(rps)}</span>
                <span className="st-keys">
                  <Key k="✎" onClick={() => setEditing(s.id)} className="st-edit" />
                  <Key k="✕" onClick={() => pressRemove(s.id)} disabled={doc.stations.length <= 1} active={removing === s.id ? true : undefined} className="st-remove">
                    {armed === `remove:${s.id}` ? 'Press again' : null}
                  </Key>
                </span>
              </div>
              {removing === s.id && (
                <div className="st-removing" data-station={s.id}>
                  <span className="engraved">
                    {used} panel{used === 1 ? '' : 's'} read {s.name}
                  </span>
                  <div className="keyrow">
                    <Key k="⌫" onClick={() => remove(s.id, {})} className="st-drop-panels">
                      Remove them too
                    </Key>
                    <Key k="✕" onClick={() => setRemoving(null)}>
                      Keep station
                    </Key>
                  </div>
                  <span className="cap">Or move them to</span>
                  <div className="stations">
                    {doc.stations
                      .filter((o) => o.id !== s.id)
                      .map((o) => (
                        <button key={o.id} className="station-pick" data-station={o.id} tabIndex={-1} onClick={() => remove(s.id, { rebind: o.id })}>
                          <StationLamp station={stations[o.id]} />
                          <span>{o.name}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {offer && doc.stations.some((s) => s.id === offer) && (
        <div className="st-offer">
          <span className="engraved">{doc.stations.find((s) => s.id === offer).name} added · also its standard pages?</span>
          <div className="keyrow">
            <Key
              k="▦"
              className="st-add-pages"
              onClick={() => {
                const at = doc.pages.length + 1;
                if (edit((d) => addStandardPages(d, offer))) onPage(at);
                setOffer(null);
              }}
            >
              Add 5 pages
            </Key>
            <Key k="✕" onClick={() => setOffer(null)}>
              No
            </Key>
          </div>
        </div>
      )}

      <div className="st-group st-available">
        <span className="cap">Available on Prometheus</span>
        {prom.values === null ? (
          <span className="engraved">{prom.contact === false ? 'No contact' : 'Asking'}</span>
        ) : available.length === 0 ? (
          <span className="engraved">Every station is on the device</span>
        ) : (
          available.map((v) => {
            const live = prom.live.get(v);
            return (
              <div key={v} className="st-row avail" data-value={v}>
                <i className={`lamp small ${live?.rps != null ? 'NOMINAL' : 'STALE'}`} />
                <span className="st-name">{v}</span>
                <span className="st-src">P50 {fmt(live?.p50, 1)} ms</span>
                <span className="num" />
                <span className="num">{fmt(live?.rps)}</span>
                <span className="st-keys">
                  <Key k="+" onClick={() => add(v)} className="st-add">
                    Add
                  </Key>
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="st-group st-cartridge">
        <span className="cap">Cartridge</span>
        <div className="keyrow">
          <Key k="⤓" onClick={download} className="st-export">
            Export
          </Key>
          <Key k="⤒" onClick={() => fileRef.current?.click()} className="st-import">
            Import
          </Key>
          <Key k="⟲" onClick={reset} className="st-reset">
            {armed === 'reset' ? 'Press again' : 'Reset'}
          </Key>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pick} />
        </div>
        {cartridge && <ImportSummary cartridge={cartridge} edit={edit} onPage={onPage} onDone={() => onCartridge(null)} />}
      </div>
    </section>
  );
}

// What a cartridge holds before it goes in: its stations and pages, or why it
// can't (nothing changes then). Replace swaps the whole document; merge adds
// its stations and pages to this one (config/stations.js).
function ImportSummary({ cartridge, edit, onPage, onDone }) {
  const r = useMemo(() => readCartridge(cartridge.text), [cartridge]);
  const take = (fn, page) => {
    if (edit(fn)) {
      if (page) onPage(page);
      onDone();
    }
  };
  return (
    <div className={`st-import-summary${r.errors ? ' bad' : ''}`}>
      <span className="st-file">{cartridge.name}</span>
      {r.errors ? (
        <>
          <span className="entry-error">Not loaded · {r.errors.length} problem{r.errors.length === 1 ? '' : 's'}</span>
          <ul className="st-errors">
            {r.errors.slice(0, 8).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {r.errors.length > 8 && <li>… and {r.errors.length - 8} more</li>}
          </ul>
        </>
      ) : (
        <span className="engraved">
          {r.summary.stations.length} station{r.summary.stations.length === 1 ? '' : 's'} · {r.summary.stations.join(', ')} · {r.summary.pages} page
          {r.summary.pages === 1 ? '' : 's'}
          {r.summary.version < 1 ? ` · migrated from v${r.summary.version}` : ''}
        </span>
      )}
      <div className="keyrow">
        {!r.errors && (
          <>
            <Key k="⇆" onClick={() => take(() => r.doc, 1)} className="st-replace">
              Replace
            </Key>
            <Key k="+" onClick={() => take((d) => mergeDocs(d, r.doc))} className="st-merge">
              Merge
            </Key>
          </>
        )}
        <Key k="✕" onClick={onDone} className="st-cancel">
          {r.errors ? 'Close' : 'Cancel'}
        </Key>
      </div>
    </div>
  );
}
