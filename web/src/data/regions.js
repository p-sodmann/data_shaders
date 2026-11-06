// Client regions by code: where traffic comes from, for the ground track and
// the origins table. Codes are IATA-style airport codes, which is what CDNs and
// load balancers usually report (`FRA`, `IAD`, ...). The probe labels requests
// with such a code (step 11); a Prometheus station joins the codes it finds
// against this table, and skips codes it doesn't know.
//
//   code: [name, lat, lon]
// Names are upper case and at most 10 characters: they are drawn in a 5 × 7
// dot font, in a fixed column of the origins table.

export const REGIONS = Object.freeze({
  // North America
  IAD: ['US EAST', 38.9, -77.4],
  JFK: ['NEW YORK', 40.6, -73.8],
  BOS: ['BOSTON', 42.4, -71.0],
  ATL: ['ATLANTA', 33.6, -84.4],
  MIA: ['MIAMI', 25.8, -80.3],
  ORD: ['CHICAGO', 42.0, -87.9],
  DFW: ['DALLAS', 32.9, -97.0],
  DEN: ['DENVER', 39.9, -104.7],
  PHX: ['PHOENIX', 33.4, -112.0],
  LAX: ['LA', 33.9, -118.4],
  SFO: ['US WEST', 37.6, -122.4],
  SEA: ['SEATTLE', 47.4, -122.3],
  YYZ: ['TORONTO', 43.7, -79.6],
  YUL: ['MONTREAL', 45.5, -73.7],
  YVR: ['VANCOUVER', 49.2, -123.2],
  MEX: ['MEXICO', 19.4, -99.1],
  // South America
  GRU: ['BRAZIL', -23.4, -46.5],
  GIG: ['RIO', -22.8, -43.2],
  EZE: ['B AIRES', -34.8, -58.5],
  SCL: ['SANTIAGO', -33.4, -70.8],
  BOG: ['BOGOTA', 4.7, -74.1],
  LIM: ['LIMA', -12.0, -77.1],
  // Europe
  LHR: ['UK', 51.5, -0.5],
  MAN: ['MANCHESTER', 53.4, -2.3],
  DUB: ['IRELAND', 53.4, -6.3],
  CDG: ['PARIS', 49.0, 2.5],
  AMS: ['AMSTERDAM', 52.3, 4.8],
  BRU: ['BRUSSELS', 50.9, 4.5],
  FRA: ['FRANKFURT', 50.0, 8.6],
  MUC: ['MUNICH', 48.4, 11.8],
  BER: ['BERLIN', 52.4, 13.5],
  HAM: ['HAMBURG', 53.6, 10.0],
  ZRH: ['ZURICH', 47.5, 8.6],
  VIE: ['VIENNA', 48.1, 16.6],
  MXP: ['MILAN', 45.6, 8.7],
  FCO: ['ROME', 41.8, 12.2],
  MAD: ['IBERIA', 40.5, -3.6],
  BCN: ['BARCELONA', 41.3, 2.1],
  LIS: ['LISBON', 38.8, -9.1],
  CPH: ['COPENHAGEN', 55.6, 12.6],
  ARN: ['STOCKHOLM', 59.6, 17.9],
  OSL: ['OSLO', 60.2, 11.1],
  HEL: ['HELSINKI', 60.3, 25.0],
  WAW: ['WARSAW', 52.2, 21.0],
  PRG: ['PRAGUE', 50.1, 14.3],
  BUD: ['BUDAPEST', 47.4, 19.3],
  OTP: ['BUCHAREST', 44.6, 26.1],
  ATH: ['ATHENS', 37.9, 23.9],
  IST: ['ISTANBUL', 41.3, 28.8],
  KBP: ['KYIV', 50.3, 30.9],
  // Africa and the Middle East
  JNB: ['S AFRICA', -26.1, 28.2],
  CPT: ['CAPE TOWN', -34.0, 18.6],
  LOS: ['LAGOS', 6.6, 3.3],
  NBO: ['NAIROBI', -1.3, 36.9],
  CAI: ['CAIRO', 30.1, 31.4],
  CMN: ['CASABLANCA', 33.4, -7.6],
  DXB: ['GULF', 25.3, 55.4],
  DOH: ['DOHA', 25.3, 51.6],
  RUH: ['RIYADH', 24.9, 46.7],
  TLV: ['TEL AVIV', 32.0, 34.9],
  // Asia and Oceania
  BOM: ['INDIA', 19.1, 72.9],
  DEL: ['DELHI', 28.6, 77.1],
  BLR: ['BANGALORE', 13.2, 77.7],
  MAA: ['CHENNAI', 13.0, 80.2],
  SIN: ['SE ASIA', 1.4, 103.99],
  KUL: ['K LUMPUR', 2.7, 101.7],
  BKK: ['BANGKOK', 13.7, 100.7],
  CGK: ['JAKARTA', -6.1, 106.7],
  MNL: ['MANILA', 14.5, 121.0],
  HKG: ['HONG KONG', 22.3, 113.9],
  TPE: ['TAIPEI', 25.1, 121.2],
  PEK: ['BEIJING', 40.1, 116.6],
  PVG: ['SHANGHAI', 31.1, 121.8],
  ICN: ['SEOUL', 37.5, 126.4],
  NRT: ['JAPAN', 35.8, 140.4],
  KIX: ['OSAKA', 34.4, 135.2],
  SYD: ['AUSTRALIA', -33.9, 151.2],
  MEL: ['MELBOURNE', -37.7, 144.8],
  PER: ['PERTH', -31.9, 116.0],
  AKL: ['AUCKLAND', -37.0, 174.8],
});

// { code, name, lat, lon } for a known code (any case), or null.
export function region(code) {
  const c = String(code).toUpperCase();
  const r = REGIONS[c];
  return r ? { code: c, name: r[0], lat: r[1], lon: r[2] } : null;
}
