import React, { useEffect, useState } from 'react';
import { fromLink, listExamples, readExample, saveAsOwn, withoutDocParams } from '../../config/examples.js';
import { Key } from '../device.jsx';

// The layouts plate: the example layouts this display can load, each with its
// stations and pages. Loading one replaces the document and makes it the
// display's own, saved like any edit, so a reload keeps it; Undo brings back
// the layout it replaced. On a display that shows a ?config= link the example
// is saved as the display's own document and the link is left, since a reload
// would otherwise show the link's document again.

const CONFIRM_MS = 3000;

function useExamples() {
  const [examples, setExamples] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await listExamples();
      const read = await Promise.all(list.map(async (e) => ({ ...e, ...(await readExample(e)) })));
      if (alive) setExamples(read);
    })();
    return () => {
      alive = false;
    };
  }, []);
  return examples;
}

export function LayoutsPlate({ meta, edit, onPage, onNotice }) {
  const examples = useExamples();
  const [armed, setArmed] = useState(null);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    if (armed === null) return undefined;
    const id = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [armed]);
  const link = fromLink(meta.origin);

  function load(e) {
    if (armed !== e.id) return setArmed(e.id);
    setArmed(null);
    if (link) {
      if (saveAsOwn(e.doc)) location.assign(withoutDocParams(location.href));
      else setProblem('not saved · is storage full or blocked?');
      return;
    }
    // the panel's notice, not this plate's: a new document remounts the workbench
    if (edit(() => e.doc)) {
      onNotice(`${e.title} loaded · saved on this display`);
      onPage(1);
    }
  }

  return (
    <section className="settings st-plate lp-plate">
      <header className="plate-head">
        <span className="name">Layouts</span>
        <span className="meta">{examples ? `${examples.length} examples` : ''}</span>
      </header>

      <span className="engraved lp-note">
        {link
          ? 'This display shows a link · loading saves the layout here and leaves the link'
          : 'Loading replaces the stations and pages · saved on this display · Undo brings the last layout back'}
      </span>

      <div className="st-table lp-list">
        {examples === null && <span className="engraved kp-empty">Reading</span>}
        {examples?.map((e) => (
          <div key={e.id} className="lp-row" data-example={e.id}>
            <div className="lp-text">
              <span className="st-name">{e.title}</span>
              <span className="st-src">{e.description}</span>
              {e.errors ? (
                <span className="entry-error">Can't load · {e.errors[0]}</span>
              ) : (
                <span className="cap">
                  {e.summary.stations.length} station{e.summary.stations.length === 1 ? '' : 's'} · {e.summary.pages} page{e.summary.pages === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <span className="st-keys">
              <Key k="⤒" onClick={() => load(e)} disabled={!!e.errors} active={armed === e.id ? true : undefined} className="lp-load">
                {armed === e.id ? 'Press again' : 'Load'}
              </Key>
            </span>
          </div>
        ))}
      </div>

      {problem && <span className="entry-error">{problem}</span>}
    </section>
  );
}
