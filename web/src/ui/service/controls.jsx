import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Key } from '../device.jsx';

// The controls on the service panel's plates. They are parts of the housing
// like the key row: keycaps, engraved fields and lamps. Nothing here may look
// like a browser form control.

const noStore = { subscribe: () => () => {}, status: 'STALE' };

// A station's live lamp: the same lamp and states as the alarm lamp, small.
// A station the manager isn't running (yet) shows dark.
export function StationLamp({ station }) {
  const store = station?.store ?? noStore;
  const status = useSyncExternalStore(store.subscribe, () => store.status);
  return <i className={`lamp small ${status}`} />;
}

// An engraved text field. Commits on Enter or when it loses focus, cancels on
// Esc; keys typed into it never reach the device's key handler.
export function Field({ value, onCommit, onCancel, maxLength = 32, autoFocus = false, className = '' }) {
  const [text, setText] = useState(value);
  const ref = useRef(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [autoFocus]);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    if (text.trim() && text !== value) onCommit(text);
    else onCancel?.();
  };
  return (
    <input
      ref={ref}
      className={`field ${className}`}
      value={text}
      maxLength={maxLength}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => (done.current = false)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          done.current = true;
          setText(value);
          onCancel?.();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// An engraved field that may be left empty: the stations plate's settings,
// where empty means "the default" (shown engraved in the field, faintly).
// Commits whatever was typed, on Enter or when it loses focus; `error` is
// written under it and keeps what was typed, so it can be corrected.
export function Entry({ value, placeholder, onCommit, onCancel, error, maxLength = 64, className = '', name }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    if (text !== value || error) onCommit(text.trim());
  };
  return (
    <span className={`entry${error ? ' bad' : ''}`}>
      <input
        className={`field ${className}`}
        value={text}
        placeholder={placeholder}
        maxLength={maxLength}
        spellCheck={false}
        data-field={name}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => (done.current = false)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit();
            done.current = false;
          }
          if (e.key === 'Escape') {
            done.current = true;
            setText(value);
            onCancel?.();
            e.currentTarget.blur();
          }
        }}
      />
      {error && <span className="entry-error">{error}</span>}
    </span>
  );
}

// A number on an engraved window between − and + keys.
export function Stepper({ value, min = -Infinity, max = Infinity, step = 1, onChange }) {
  const set = (v) => onChange(Math.min(max, Math.max(min, +(v.toFixed(6)))));
  return (
    <span className="stepper">
      <Key k="−" onClick={() => set(value - step)} disabled={value <= min} />
      <span className="window">{value}</span>
      <Key k="+" onClick={() => set(value + step)} disabled={value >= max} />
    </span>
  );
}

// One option of an instrument, rendered from its registry schema.
export function OptionControl({ spec, value, onChange }) {
  switch (spec.type) {
    case 'enum':
      return (
        <span className="keyrow">
          {spec.values.map((v) => (
            <Key key={v} k={v.slice(0, 1).toUpperCase()} active={value === v} onClick={() => onChange(v)}>
              {v}
            </Key>
          ))}
        </span>
      );
    case 'boolean':
      return (
        <Key k={value ? 'I' : 'O'} active={!!value} onClick={() => onChange(!value)}>
          {value ? 'On' : 'Off'}
        </Key>
      );
    case 'number':
      return <Stepper value={value ?? spec.default ?? 0} min={spec.min} max={spec.max} step={spec.step} onChange={onChange} />;
    case 'string':
      return <Field value={value ?? ''} maxLength={spec.max ?? 32} onCommit={onChange} />;
    default:
      return <span className="engraved">?</span>;
  }
}

// A row on a plate: an engraved caption on the left, its control on the right.
export function Row({ label, children }) {
  return (
    <div className="plate-row">
      <span className="cap">{label}</span>
      <div className="plate-ctl">{children}</div>
    </div>
  );
}
