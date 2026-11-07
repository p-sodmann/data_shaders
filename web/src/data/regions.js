// Named import: Vite tree-shakes the probe's country map out of the bundle.
import { regions } from './regions.json';

// Client regions by code: where traffic comes from, for the ground track and
// the origins table. Codes are IATA-style airport codes, which is what CDNs and
// load balancers usually report (`FRA`, `IAD`, ...). The probe labels requests
// with such a code (step 11); a Prometheus station joins the codes it finds
// against this table, and skips codes it doesn't know.
//
// The table belongs to the probe (probe/src/mars_probe/regions.json, which also
// maps countries to regions). regions.json here is a verbatim copy, because
// the web image is built from web/ alone; test/regions.test.js fails when the
// two differ. To change it, edit the probe's file and copy it over.
//
//   code: [name, lat, lon]
// Names are upper case and at most 10 characters: they are drawn in a 5 × 7
// dot font, in a fixed column of the origins table.

export const REGIONS = Object.freeze(regions);

// { code, name, lat, lon } for a known code (any case), or null.
export function region(code) {
  const c = String(code).toUpperCase();
  const r = REGIONS[c];
  return r ? { code: c, name: r[0], lat: r[1], lon: r[2] } : null;
}
