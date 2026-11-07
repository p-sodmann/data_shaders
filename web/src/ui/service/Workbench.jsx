import React, { useEffect, useRef, useState } from 'react';
import { GRID } from '../../config/schema.js';
import { REGISTRY } from '../../instruments/registry.js';
import {
  addPanel,
  addStandardPages,
  duplicatePanel,
  firstStation,
  fits,
  placeFor,
  placePanels,
  removePanel,
  setLocked,
  swapPanel,
  updatePanel,
} from '../../config/edit.js';
import { Key } from '../device.jsx';
import { moduleNumber } from '../PageView.jsx';
import { EditableDeck } from './EditableDeck.jsx';
import { KeysPlate } from './KeysPlate.jsx';
import { ModuleBay } from './ModuleBay.jsx';
import { SettingsPlate } from './SettingsPlate.jsx';
import { StationsPlate } from './StationsPlate.jsx';
import { StationLamp } from './controls.jsx';

// The open housing (step 08): the editable deck, and beside it the service
// column with the cartridge state, the selected module's settings plate (or
// the standard-pages chooser) and the module bay. The STATIONS key swaps the
// plate and the bay for the stations plate (step 09), and widens the column
// for its table; the deck stays in view, so threshold changes show as they
// are made. The KEYS key does the same for the push keys plate (ADR-0010).
//
// edit(fn) applies a document edit and returns false (showing why on the
// panel) when the store refuses it; onNotice(text) shows a refusal that
// never reached the store.

const ORIGIN = {
  url: 'URL cartridge · not saved',
  'url-local': 'URL cartridge · local copy wins',
  local: 'Saved on this display',
  server: 'Server copy · saved on first change',
  default: 'Built-in · saved on first change',
};

export function Workbench({ doc, meta, pageIndex, stations, device, named, first, edit, notice, onNotice, store, stdOpen, onStdClose, onPage, stationsOpen, onStationsToggle, cartridge, onCartridge }) {
  const page = doc.pages[pageIndex];
  const [selected, setSelected] = useState(null);
  // Revert to URL throws away this display's edits: it needs two presses
  const [confirmRevert, setConfirmRevert] = useState(false);
  useEffect(() => {
    if (!confirmRevert) return undefined;
    const id = setTimeout(() => setConfirmRevert(false), 3000);
    return () => clearTimeout(id);
  }, [confirmRevert]);
  const revert = () => {
    if (!confirmRevert) return setConfirmRevert(true);
    if (store.revert()) location.reload();
    else onNotice('local copy not removed');
  };
  const [swapping, setSwapping] = useState(false);
  // the keys plate; the stations plate wins while it is open too
  const [sideWanted, setSide] = useState(null);
  const side = stationsOpen ? null : sideWanted;
  const toggleSide = (name) => {
    if (stationsOpen) onStationsToggle();
    setSide(side === name ? null : name);
  };
  const carried = useRef(null);
  const panel = page.panels.find((p) => p.id === selected) ?? null;

  useEffect(() => setSwapping(false), [selected]);

  // Delete removes the selected module (Backspace too, for laptop keyboards).
  const live = useRef(null);
  live.current = { selected, pageIndex };
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const { selected: id, pageIndex: pi } = live.current;
      if ((e.key === 'Delete' || e.key === 'Backspace') && id) {
        e.preventDefault();
        if (edit((d) => removePanel(d, pi, id))) setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [edit]);

  const place = (type, rect) => {
    let id = null;
    const def = REGISTRY[type];
    const ok = edit((d) => {
      const r = addPanel(d, pageIndex, { type, station: firstStation(d, def), rect });
      id = r.id;
      return r.doc;
    });
    if (ok) setSelected(id);
  };

  const pick = (type) => {
    if (swapping && panel) {
      if (edit((d) => swapPanel(d, pageIndex, panel.id, type, REGISTRY[type]))) setSwapping(false);
      return;
    }
    const rect = placeFor(page.panels, REGISTRY[type]);
    if (rect) place(type, rect);
  };

  const drop = (rect) => {
    const type = carried.current;
    carried.current = null;
    if (!type) return;
    const def = REGISTRY[type];
    // the drop size is the default; shrink it to the minimum if that is what fits here
    const tries = [rect, { ...rect, w: def.minW, h: def.minH }];
    const spot = tries.find((r) => fits(page.panels, r));
    if (spot) place(type, spot);
    else onNotice(`no room for ${def.minW} × ${def.minH} there`);
  };

  const num = panel ? moduleNumber(first, page.panels.indexOf(panel)) : null;

  return (
    <div className={`workbench${stationsOpen || side ? ' wide' : ''}`}>
      <EditableDeck
        page={page}
        stations={stations}
        device={device}
        named={named}
        first={first}
        selected={selected}
        onSelect={setSelected}
        onPlace={(moves) => edit((d) => placePanels(d, pageIndex, moves))}
        onDrop={drop}
        dropSize={() => {
          const def = REGISTRY[carried.current];
          return def ? { w: def.defaultSize[0], h: def.defaultSize[1] } : null;
        }}
      />

      <aside className="service">
        <section className="svc-head">
          <div className="svc-title">
            <span className="cap">Service</span>
            <span className="cartridge" data-origin={meta.origin}>
              {meta.readOnly ? ORIGIN.url : ORIGIN[meta.origin]}
            </span>
          </div>
          <div className="keyrow">
            {meta.readOnly && (
              <Key k="⤓" onClick={store.save} className="save-local">
                Save as local
              </Key>
            )}
            {meta.origin === 'url-local' && (
              <Key k="⤒" onClick={revert} className="revert-url">
                {confirmRevert ? 'Press again' : 'Revert to URL'}
              </Key>
            )}
            <Key k="↶" onClick={store.undo} disabled={!meta.canUndo}>
              Undo
            </Key>
            <Key k="↷" onClick={store.redo} disabled={!meta.canRedo}>
              Redo
            </Key>
            <Key k="L" active={doc.device.locked} onClick={() => edit((d) => setLocked(d, !d.device.locked))}>
              Lock
            </Key>
            <Key k="⌗" active={stationsOpen} onClick={onStationsToggle} className="stations-key">
              Stations
            </Key>
            <Key k="K" active={side === 'keys'} onClick={() => toggleSide('keys')} className="keys-key">
              Keys
            </Key>
          </div>
          {notice && <div className="notice">{notice}</div>}
        </section>

        {stationsOpen ? (
          <StationsPlate doc={doc} stations={stations} edit={edit} onPage={onPage} cartridge={cartridge} onCartridge={onCartridge} />
        ) : side === 'keys' ? (
          <KeysPlate doc={doc} />
        ) : stdOpen ? (
          <section className="settings">
            <header className="plate-head">
              <span className="name">Standard pages for station</span>
            </header>
            <div className="stations">
              {doc.stations.map((s) => (
                <button
                  key={s.id}
                  className="station-pick"
                  data-station={s.id}
                  tabIndex={-1}
                  onClick={() => {
                    const at = doc.pages.length + 1;
                    if (edit((d) => addStandardPages(d, s.id))) {
                      onStdClose();
                      onPage(at);
                    }
                  }}
                >
                  <StationLamp station={stations[s.id]} />
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
            <div className="plate-keys">
              <Key k="✕" onClick={onStdClose}>
                Close
              </Key>
            </div>
          </section>
        ) : panel ? (
          <SettingsPlate
            panel={panel}
            num={num}
            doc={doc}
            stations={stations}
            swapping={swapping}
            onChange={(patch) => edit((d) => updatePanel(d, pageIndex, panel.id, patch))}
            onRemove={() => edit((d) => removePanel(d, pageIndex, panel.id)) && setSelected(null)}
            onDuplicate={() => {
              let id = null;
              const ok = edit((d) => {
                const r = duplicatePanel(d, pageIndex, panel.id);
                id = r.id;
                return r.doc;
              });
              if (ok) setSelected(id);
            }}
            onSwap={() => setSwapping((s) => !s)}
          />
        ) : (
          <section className="settings hint">
            <span className="engraved">Select a module · carry it by its label · the notch resizes</span>
          </section>
        )}

        {!stationsOpen && !side && (
          <ModuleBay
            panels={page.panels}
            swapping={swapping}
            onPick={pick}
            onCarry={(type) => (carried.current = type)}
            notice={`${freeCells(page.panels)} free cells`}
          />
        )}
      </aside>
    </div>
  );
}

const freeCells = (panels) => GRID.cols * GRID.rows - panels.reduce((n, p) => n + p.w * p.h, 0);
