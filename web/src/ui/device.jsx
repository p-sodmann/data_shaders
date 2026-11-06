import React, { createContext, useContext, useEffect, useRef } from 'react';

// The physical parts every screen is made of: a module (engraved header plus
// whatever sits below it) and a screen (bezel and glass, registered with the
// shared WebGL engine while mounted).

export const EngineContext = createContext(null);

export function Screen({ inst, children }) {
  const engine = useContext(EngineContext);
  const ref = useRef(null);
  useEffect(() => (engine ? engine.add(ref.current, inst) : undefined), [engine, inst]);
  return (
    <div className="bezel">
      <div className="glass" ref={ref}>
        {children}
      </div>
    </div>
  );
}

export function Module({ num, name, meta, className = '', style, children }) {
  return (
    <section className={`mod ${className}`} style={style}>
      <header className="mod-head">
        {num && <span className="num">{num}</span>}
        <span className="name">{name}</span>
        {meta && <span className="meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}
