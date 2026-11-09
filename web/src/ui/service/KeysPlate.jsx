import React, { useEffect, useMemo, useState } from 'react';
import { ago, createKeysClient, keyProblem, keyStations, pushSetup } from '../../data/keys.js';
import { Key } from '../device.jsx';
import { Entry } from './controls.jsx';

// The keys plate (ADR-0010): the push keys mars-gateway knows, the clients
// pushing with each, and a new key. A key belongs to one station: a host
// running mars-agent, or an app with mars-probe, pushes as that station with
// it, and shows up as one of its nodes. The token of a new key is shown here
// once, with what to paste on the client; the gateway keeps only its hash.

const POLL_MS = 2000;
const CONFIRM_MS = 3000;

function useKeys(client) {
  const [state, setState] = useState({ keys: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer = null;
    const poll = async () => {
      try {
        const keys = await client.list();
        if (alive) setState({ keys, error: null });
      } catch (e) {
        if (alive) setState((s) => ({ keys: s.keys, error: e.message }));
      }
      if (alive) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client, tick]);
  return [state, () => setTick((t) => t + 1)];
}

// the clipboard API needs a secure context, which a LAN display on http isn't
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function KeysPlate({ doc }) {
  const client = useMemo(() => createKeysClient(), []);
  const [{ keys, error }, refresh] = useKeys(client);
  const suggestions = useMemo(() => keyStations(doc), [doc]);
  const [draft, setDraft] = useState({ name: '', station: suggestions[0] ?? '' });
  const [problem, setProblem] = useState(null);
  const [made, setMade] = useState(null); // { key, token } until Done
  const [copied, setCopied] = useState(null);
  const [armed, setArmed] = useState(null);
  useEffect(() => {
    if (armed === null) return undefined;
    const id = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  async function make() {
    const why = keyProblem(draft.name, draft.station);
    if (why) return setProblem(why);
    try {
      setMade(await client.create(draft.name.trim(), draft.station));
      setDraft({ name: '', station: draft.station });
      setProblem(null);
      refresh();
    } catch (e) {
      setProblem(e.message);
    }
  }

  async function revoke(id) {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    try {
      await client.revoke(id);
      if (made?.key.id === id) setMade(null);
      refresh();
    } catch (e) {
      setProblem(e.message);
    }
  }

  async function changeStation(key, station) {
    if (station === key.station) return;
    const why = keyProblem(key.name, station);
    if (why) return setProblem(why);
    try {
      const result = await client.updateStation(key.id, station);
      setMade((m) => m?.key.id === key.id ? { ...m, key: result.key } : m);
      setProblem(null);
      refresh();
    } catch (e) {
      setProblem(e.message);
    }
  }

  async function copyOut(what, text) {
    if (await copy(text)) setCopied(what);
  }

  const setup = made ? pushSetup(location.origin, made.token) : null;

  return (
    <section className="settings st-plate kp-plate">
      <header className="plate-head">
        <span className="name">Push keys</span>
        <span className="meta">{keys ? `${keys.length} key${keys.length === 1 ? '' : 's'}` : ''}</span>
      </header>

      <div className="st-prom">
        <span className="cap">Gateway</span>
        <span className="st-contact">
          <i className={`lamp small ${keys && !error ? 'NOMINAL' : 'STALE'}`} />
          <span className="cap">{error ? `No contact · ${error}` : keys ? 'Contact' : 'Calling'}</span>
        </span>
      </div>

      <div className="st-table" role="table">
        <div className="st-row st-caps" role="row">
          <span />
          <span className="cap">Name</span>
          <span className="cap">Station</span>
          <span className="cap num">Nodes</span>
          <span className="cap num">Push</span>
          <span />
        </div>
        {keys?.length === 0 && <span className="engraved kp-empty">No keys yet · make one below</span>}
        {keys?.map((k) => {
          const live = k.clients.filter((c) => c.live);
          const last = Math.max(0, ...k.clients.map((c) => c.lastPush));
          return (
            <React.Fragment key={k.id}>
              <div className="st-row" role="row" data-key={k.id}>
                <i className={`lamp small ${live.length ? 'NOMINAL' : k.clients.length ? 'DEGRADED' : 'STALE'}`} />
                <span className="st-name kp-name">{k.name}</span>
                <span className="st-src">
                  {k.source === 'env' ? k.station : (
                    <Entry name={`station-${k.id}`} value={k.station} className="plain" maxLength={32}
                      onCommit={(station) => changeStation(k, station)} />
                  )}
                </span>
                <span className="num">
                  {live.length}/{k.clients.length}
                </span>
                <span className="num">{ago(last)}</span>
                <span className="st-keys">
                  <Key k="✕" onClick={() => revoke(k.id)} disabled={k.source === 'env'} className="kp-revoke">
                    {armed === k.id ? 'Press again' : null}
                  </Key>
                </span>
              </div>
              {k.clients.length > 0 && (
                <div className="kp-clients">
                  {k.clients.map((c) => (
                    <span key={c.instance} className={c.live ? 'live' : ''}>
                      {c.instance}
                    </span>
                  ))}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {made && (
        <div className="st-offer kp-made" data-key={made.key.id}>
          <span className="engraved">
            Key for {made.key.station} · shown once · copy it now
          </span>
          <input className="field plain kp-token" readOnly value={made.token} onFocus={(e) => e.target.select()} onKeyDown={(e) => e.stopPropagation()} />
          <span className="cap">Linux host · in a checkout of MARS</span>
          <pre className="kp-setup">{setup.agent}</pre>
          <span className="cap">App with mars-probe · environment</span>
          <pre className="kp-setup">{setup.probe}</pre>
          <div className="keyrow">
            <Key k="⧉" onClick={() => copyOut('key', made.token)} className="kp-copy">
              {copied === 'key' ? 'Copied' : 'Copy key'}
            </Key>
            <Key k="⧉" onClick={() => copyOut('agent', setup.agent)}>
              {copied === 'agent' ? 'Copied' : 'Copy command'}
            </Key>
            <Key
              k="✓"
              onClick={() => {
                setMade(null);
                setCopied(null);
              }}
            >
              Done
            </Key>
          </div>
        </div>
      )}

      <div className="st-group kp-new">
        <span className="cap">New key</span>
        <div className="st-fields kp-fields">
          <label className="st-field">
            <span className="cap">Name</span>
            <Entry name="key-name" value={draft.name} placeholder="web hosts" maxLength={48} onCommit={(t) => setDraft((d) => ({ ...d, name: t }))} />
          </label>
          <label className="st-field">
            <span className="cap">Station</span>
            <Entry name="key-station" value={draft.station} placeholder="fleet" className="plain" maxLength={32} onCommit={(t) => setDraft((d) => ({ ...d, station: t }))} />
          </label>
        </div>
        {suggestions.length > 0 && (
          <div className="stations kp-suggest">
            {suggestions.map((s) => (
              <button key={s} className={`station-pick${draft.station === s ? ' on' : ''}`} tabIndex={-1} onClick={() => setDraft((d) => ({ ...d, station: s }))}>
                <span>{s}</span>
              </button>
            ))}
          </div>
        )}
        {problem && <span className="entry-error">{problem}</span>}
        <div className="keyrow">
          <Key k="+" onClick={make} className="kp-make">
            Make key
          </Key>
        </div>
        <span className="engraved kp-hint">
          Edit a key’s station above · clients keep the same key · a new station appears under Stations · Available once it pushes
        </span>
      </div>
    </section>
  );
}
