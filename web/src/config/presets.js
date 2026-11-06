// The five standard pages, as a generator so a document can have them for
// any station ("the 5 standard pages for station X"). The built-in default
// document binds them to the station `main`.
// Positions are on the 12 × 8 deck grid (ADR-0005). Rows 0–5 are the old
// deck and rows 6–7 the old bank below it, which keeps their 72 : 28 split
// (the old split was about 71 : 29 at 1920 × 1080).
//
// Panel order is module-number order: numbers are assigned in panel order
// across pages, and the narrow-screen layout stacks panels in this order.

// `prefix` goes in front of every page id, so the standard pages of two
// stations can sit in one document (page ids are unique per document).
export function standardPages(station, prefix = '') {
  const panel = (id, type, x, y, w, h, options = {}) => ({ id, type, station, x, y, w, h, options });
  return PAGES(panel).map((p) => ({ ...p, id: prefix + p.id }));
}

const PAGES = (panel) => [
  {
    id: 'tape',
    name: 'Tape',
    panels: [
      panel('tape', 'tape', 0, 0, 8, 6),
      panel('load', 'meter', 8, 0, 4, 3),
      panel('nodes', 'matrix', 8, 3, 4, 3),
      panel('latency', 'readout', 0, 6, 2, 2, { signal: 'latency' }),
      panel('throughput', 'readout', 2, 6, 2, 2, { signal: 'throughput' }),
      panel('errors', 'readout', 4, 6, 2, 2, { signal: 'errors' }),
      panel('log', 'log', 6, 6, 6, 2),
    ],
  },
  {
    id: 'orbit',
    name: 'Orbit',
    panels: [
      panel('orbit', 'orbit', 0, 0, 7, 6),
      panel('fleet', 'fleet', 7, 0, 5, 3),
      panel('pipeline', 'pipeline', 0, 6, 5, 2),
      panel('slices', 'slices', 7, 3, 5, 3),
      panel('rules', 'rules', 5, 6, 4, 2),
      panel('trace', 'trace', 9, 6, 3, 2),
    ],
  },
  {
    id: 'sweep',
    name: 'Sweep',
    panels: [
      panel('radar', 'radar', 0, 0, 5, 6),
      panel('ground', 'ground', 5, 0, 7, 6),
      panel('contacts', 'contacts', 0, 6, 6, 2),
      panel('origins', 'origins', 6, 6, 6, 2),
    ],
  },
  {
    id: 'signal',
    name: 'Signal',
    panels: [
      panel('spectrum', 'spectrum', 0, 0, 7, 3),
      panel('waterfall', 'waterfall', 0, 3, 7, 3),
      panel('xy', 'xy', 7, 0, 5, 6),
      panel('correlator', 'correlator', 0, 6, 6, 2),
      panel('rhythms', 'rhythms', 6, 6, 6, 2),
    ],
  },
  {
    id: 'almanac',
    name: 'Almanac',
    panels: [
      panel('dial', 'dial', 0, 0, 4, 6),
      panel('heatmap', 'heatmap', 4, 0, 8, 6),
      panel('budget', 'budget', 0, 6, 3, 2),
      panel('burn', 'burn', 3, 6, 5, 2),
      panel('logbook', 'logbook', 8, 6, 4, 2),
    ],
  },
];

export const DEFAULT_PAGES = standardPages('main');
