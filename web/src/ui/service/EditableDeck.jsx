import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactGridLayout from 'react-grid-layout';
import { absoluteStrategy, getCompactor } from 'react-grid-layout/core';
import { GRID } from '../../config/schema.js';
import { REGISTRY } from '../../instruments/registry.js';
import { EngineContext } from '../device.jsx';
import { Panel, moduleNumber } from '../PageView.jsx';

// The deck with its housing open (ADR-0006): the same panels as PageView, on
// react-grid-layout so they can be moved and resized. The grid is the
// document's 12 × 8: no compaction, no collisions, nothing past row 8, and the
// row height is worked out from the deck's height so the grid fills it.
//
// Positions are absolute (top/left), not CSS transforms: a transform would
// make each module a stacking context and put its glass overlays under the
// WebGL canvas. None of react-grid-layout's own CSS is loaded; style.css
// draws the slots, the placeholder and the resize notch.

const compactor = getCompactor(null, false, true); // free placement, collisions blocked
const DROP_ID = '__dropping-elem__';

// The deck's gaps are in vmin (style.css: 1.8vmin rows, 2.4vmin columns).
function gaps() {
  const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
  return [2.4 * vmin, 1.8 * vmin];
}

const notch = (axis, ref) => <span ref={ref} className={`react-resizable-handle notch notch-${axis}`} />;

const sizeOf = (type) => {
  const def = REGISTRY[type];
  return def ? { minW: def.minW, minH: def.minH } : { minW: 1, minH: 1 };
};

// selected: panel id or null. onPlace(moves) after a drag or resize; onDrop(rect)
// when an instrument from the bay is let go over the grid; dropSize() gives the
// size of the instrument being carried (or null if nothing from the bay is).
export function EditableDeck({ page, stations, device, named, first, selected, onSelect, onPlace, onDrop, dropSize }) {
  const engine = useContext(EngineContext);
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  const [sizing, setSizing] = useState(null); // { id, w, h } while resizing

  // never leave the engine held if the housing closes mid-drag
  useEffect(() => () => engine?.hold(false), [engine]);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height, margin: gaps() }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => page.panels.map((p) => ({ i: p.id, x: p.x, y: p.y, w: p.w, h: p.h, ...sizeOf(p.type) })), [page.panels]);

  const rowHeight = box ? Math.max(1, (box.h - (GRID.rows - 1) * box.margin[1]) / GRID.rows) : 1;
  // Dots engraved at the cell corners, one in the middle of each gap crossing.
  // A background tile has its dot in the centre, so tiles are shifted by half
  // a pitch plus half a gap; the crossings on the outer edge fall outside.
  const pitch = box && [(box.w + box.margin[0]) / GRID.cols, rowHeight + box.margin[1]];
  const dots = box && {
    '--pitch-x': `${pitch[0]}px`,
    '--pitch-y': `${pitch[1]}px`,
    '--off-x': `${-(pitch[0] + box.margin[0]) / 2}px`,
    '--off-y': `${-(pitch[1] + box.margin[1]) / 2}px`,
  };

  // while a module is carried the screens keep their last frame
  const hold = (on) => engine?.hold(on);
  const stop = (l) => {
    hold(false);
    setSizing(null);
    onPlace(l.filter((it) => it.i !== DROP_ID).map(({ i, x, y, w, h }) => ({ id: i, x, y, w, h })));
  };

  return (
    <main className="deck editing" ref={ref} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
      {box && (
        <ReactGridLayout
          className="service-grid"
          style={{ height: '100%', ...dots }}
          width={box.w}
          autoSize={false}
          layout={layout}
          gridConfig={{ cols: GRID.cols, rowHeight, margin: box.margin, containerPadding: [0, 0], maxRows: GRID.rows }}
          dragConfig={{ enabled: true, bounded: true, handle: '.mod-head', threshold: 4 }}
          resizeConfig={{ enabled: true, handles: ['se'], handleComponent: notch }}
          dropConfig={{ enabled: true, defaultItem: { w: 2, h: 2 } }}
          onDropDragOver={() => dropSize() ?? false}
          positionStrategy={absoluteStrategy}
          compactor={compactor}
          onDragStart={() => hold(true)}
          onDragStop={stop}
          onResizeStart={(_l, _old, item) => {
            hold(true);
            setSizing({ id: item.i, w: item.w, h: item.h });
          }}
          onResize={(_l, _old, item) => setSizing({ id: item.i, w: item.w, h: item.h })}
          onResizeStop={stop}
          onDrop={(_l, item) => item && onDrop({ x: item.x, y: item.y, w: item.w, h: item.h })}
        >
          {page.panels.map((panel, i) => {
            const def = REGISTRY[panel.type];
            const size = sizing?.id === panel.id ? sizing : null;
            return (
              <div
                key={panel.id}
                className={`slot${selected === panel.id ? ' selected' : ''}`}
                data-panel={panel.id}
                onClick={() => onSelect(panel.id)}
              >
                <Panel panel={panel} stations={stations} device={device} named={named} num={moduleNumber(first, i)} />
                <i className="screw tl" />
                <i className="screw tr" />
                <i className="screw bl" />
                {size && (
                  <span className="sizeplate">
                    {size.w} × {size.h}
                    {def?.aspect ? ` · aspect ${def.aspect}` : ''}
                  </span>
                )}
              </div>
            );
          })}
        </ReactGridLayout>
      )}
    </main>
  );
}
