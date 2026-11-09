import { describe, expect, it } from 'vitest';
import { ago, createKeysClient, keyProblem, keyStations, pushSetup } from '../src/data/keys.js';

// a fetch that records calls and answers from a queue
function fakeFetch(...answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, ...init });
    const [status, body] = answers.shift();
    return { status, ok: status < 400, json: async () => body };
  };
  return { f, calls };
}

describe('keys client', () => {
  it('lists, creates and revokes through /api/keys', async () => {
    const { f, calls } = fakeFetch(
      [200, { keys: [{ id: 'a1', station: 'web' }] }],
      [201, { key: { id: 'b2', station: 'web' }, token: 'mars_x' }],
      [204, null],
    );
    const keys = createKeysClient({ fetch: f });
    expect(await keys.list()).toEqual([{ id: 'a1', station: 'web' }]);
    expect((await keys.create('web hosts', 'web')).token).toBe('mars_x');
    expect(await keys.revoke('b2')).toBeNull();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/keys', 'POST /api/keys', 'DELETE /api/keys/b2']);
    // JSON, so the gateway takes it (and a cross-site form can't)
    expect(calls[1].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[1].body)).toEqual({ name: 'web hosts', station: 'web' });
  });

  it('changes a station without replacing the token', async () => {
    const { f, calls } = fakeFetch([200, { key: { id: 'a1', station: 'fleet-01' } }]);
    const keys = createKeysClient({ fetch: f });
    expect((await keys.updateStation('a1', 'fleet-01')).key.station).toBe('fleet-01');
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toBe('/api/keys/a1');
    expect(JSON.parse(calls[0].body)).toEqual({ station: 'fleet-01' });
  });

  it("throws the gateway's reason", async () => {
    const { f } = fakeFetch([400, { error: 'station: lower case' }], [502, {}]);
    const keys = createKeysClient({ fetch: f });
    await expect(keys.create('x', 'Web')).rejects.toThrow('station: lower case');
    await expect(keys.list()).rejects.toThrow('gateway answered 502');
  });
});

describe('key helpers', () => {
  it('checks a new key before it is sent', () => {
    expect(keyProblem('', 'web')).toMatch(/name/);
    expect(keyProblem('web hosts', 'Web')).toMatch(/station/);
    expect(keyProblem('web hosts', 'web')).toBeNull();
  });

  it("offers the document's Prometheus stations", () => {
    const doc = {
      stations: [
        { source: { kind: 'prometheus', station: 'api' } },
        { source: { kind: 'sim' } },
        { source: { kind: 'prometheus', station: 'api' } },
        { source: { kind: 'prometheus', station: 'fleet' } },
      ],
    };
    expect(keyStations(doc)).toEqual(['api', 'fleet']);
  });

  it('writes the client set-up and ages', () => {
    const s = pushSetup('http://mars.lan:8080', 'mars_x');
    expect(s.agent).toContain('MARS_PUSH_URL=http://mars.lan:8080 MARS_PUSH_KEY=mars_x');
    expect(ago(0)).toBe('–');
    expect(ago(100, 104)).toBe('4 s');
    expect(ago(0.001, 3 * 3600)).toBe('3 h');
  });
});
