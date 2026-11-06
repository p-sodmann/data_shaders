import React from 'react';
import { REGISTRY, panelName, resolveOptions } from '../../instruments/registry.js';
import { placeFor } from '../../config/edit.js';

// The module bay: every instrument in the registry as a small engraved
// faceplate. Click one to fit it into the first free spot of the page, or drag
// it onto the deck. In swap mode a click replaces the selected module instead.

const TYPES = Object.keys(REGISTRY);

// onPick(type) on click; onCarry(type | null) while one is dragged out
export function ModuleBay({ panels, swapping, onPick, onCarry, notice }) {
  const room = TYPES.map((type) => !!placeFor(panels, REGISTRY[type]));
  const full = !room.some(Boolean);
  const status = swapping ? 'Swap · pick the new module' : full ? 'Page full' : notice;
  return (
    <section className="bay">
      <header className="bay-head">
        <span className="cap">Module bay</span>
        {status && <span className={`bay-status${full && !swapping ? ' full' : ''}`}>{status}</span>}
      </header>
      <div className="bay-list">
        {TYPES.map((type, i) => {
          const def = REGISTRY[type];
          const fits = room[i] || swapping;
          return (
            <div
              key={type}
              className={`faceplate${fits ? '' : ' no-room'}`}
              data-type={type}
              draggable={!swapping && room[i]}
              onClick={() => fits && onPick(type)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', type); // Firefox won't drag without data
                e.dataTransfer.effectAllowed = 'copy';
                onCarry(type);
              }}
              onDragEnd={() => onCarry(null)}
            >
              <span className="fp-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="fp-name">{panelName(def, resolveOptions(def))}</span>
              <span className="fp-size">
                {def.defaultSize[0]} × {def.defaultSize[1]}
              </span>
              <span className="fp-reads">{def.reads}</span>
              {(def.needs.length > 0 || def.scope !== 'station') && (
                <span className="fp-needs">
                  {def.scope === 'either' && <i>All stations</i>}
                  {def.needs.map((n) => (
                    <i key={n}>{n}</i>
                  ))}
                </span>
              )}
              {!fits && <span className="fp-full">No room</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
