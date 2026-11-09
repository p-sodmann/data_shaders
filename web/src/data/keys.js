// Push keys (ADR-0010): the keys plate's calls to mars-gateway, which Caddy
// serves at /api/keys on the display's own origin. A key belongs to one
// station; whoever holds it can push as that station. The token comes back
// once, from create, and is never listed again.

const STATION = /^[a-z][a-z0-9-]{0,31}$/;

export function createKeysClient({ base = '/api/keys', fetch: f = globalThis.fetch.bind(globalThis), timeout = 3000 } = {}) {
  async function call(method, path = '', body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await f(base + path, {
        method,
        signal: ctl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 204) return null;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `gateway answered ${res.status}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    list: async () => (await call('GET')).keys,
    create: (name, station) => call('POST', '', { name, station }),
    updateStation: (id, station) => call('PATCH', `/${encodeURIComponent(id)}`, { station }),
    revoke: (id) => call('DELETE', `/${encodeURIComponent(id)}`),
  };
}

// why a new key can't be made with these, or null
export function keyProblem(name, station) {
  if (!name.trim()) return 'name the key';
  if (name.trim().length > 48) return 'name: at most 48 characters';
  if (!STATION.test(station)) return 'station: lower case, digits, dashes';
  return null;
}

// The stations a key is likely for: the Prometheus stations of the document.
export const keyStations = (doc) => [...new Set(doc.stations.filter((s) => s.source.kind === 'prometheus').map((s) => s.source.station))];

// What to paste on a client, for the plate to show beside a new token.
export function pushSetup(origin, token) {
  return {
    agent: `MARS_PUSH_URL=${origin} MARS_PUSH_KEY=${token} docker compose -f agent/compose.yaml up -d`,
    probe: `MARS_PUSH_URL=${origin}\nMARS_PUSH_KEY=${token}`,
  };
}

// "4 s", "12 min", "3 h" since a unix time in seconds; "–" for never
export function ago(t, now = Date.now() / 1000) {
  if (!t) return '–';
  const s = Math.max(0, now - t);
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
